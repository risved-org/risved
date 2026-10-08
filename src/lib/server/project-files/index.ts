import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { projectVolumeName } from '$lib/server/pipeline/docker'
import { validateFilePath, type ProjectFile } from '$lib/project-files'
import { volumeScript } from './volume-script'

export class FileOperationError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message)
	}
}

export interface FileRequest {
	operation: 'list' | 'upload' | 'delete'
	path: string
	page?: number
	content?: string
	replace?: boolean
}

export interface FileResult {
	entries?: ProjectFile[]
	page?: number
	hasNext?: boolean
	error?: string
	status?: number
}

/** Access a project's named volume independently of its app container or framework. */
export async function projectFiles(projectId: string, input: FileRequest): Promise<FileResult> {
	if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new FileOperationError(400, 'Invalid project ID')
	try {
		validateFilePath(input.path, input.operation === 'list')
	} catch (error) {
		throw new FileOperationError(400, (error as Error).message)
	}
	if (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1))
		throw new FileOperationError(400, 'Choose a valid page number.')
	const name = `risved-files-${randomUUID()}`
	const args = [
		'run',
		'--rm',
		'-i',
		'--name',
		name,
		'--network',
		'none',
		'--read-only',
		'--security-opt',
		'no-new-privileges',
		'--cap-drop',
		'ALL',
		'--cap-add',
		'CHOWN',
		'--cap-add',
		'DAC_OVERRIDE',
		'--cap-add',
		'FOWNER',
		'--pids-limit',
		'32',
		'--memory',
		'256m',
		'--cpus',
		'0.5',
		'-v',
		`${projectVolumeName(projectId)}:/data${input.operation === 'list' ? ':ro' : ''}`,
		'node:22-slim',
		'node',
		'-e',
		volumeScript
	]
	try {
		const result = await new Promise<FileResult>((resolve, reject) => {
			const child = execFile(
				'docker',
				args,
				{ timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
				(error, stdout) => {
					if (error)
						return reject(
							new FileOperationError(
								503,
								'Project storage is unavailable. Check that Docker is running and can pull node:22-slim.'
							)
						)
					try {
						resolve(JSON.parse(stdout))
					} catch {
						reject(new FileOperationError(503, 'Project storage returned an invalid response.'))
					}
				}
			)
			child.stdin?.on('error', () => {})
			child.stdin?.end(JSON.stringify(input))
		})
		if (result.error) throw new FileOperationError(result.status ?? 500, result.error)
		return result
	} finally {
		await new Promise<void>(resolve => {
			execFile('docker', ['rm', '-f', name], { timeout: 5000 }, () => resolve())
		})
	}
}
