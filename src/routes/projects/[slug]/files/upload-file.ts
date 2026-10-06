import { deserialize } from '$app/forms'
import { MAX_FILE_BYTES, validateFilePath } from '$lib/project-files'

export interface UploadEntry {
	file: File
	path: string
	replace: boolean
	status: 'ready' | 'uploading' | 'uploaded' | 'failed' | 'conflict'
	message: string
}

/** Send one file at a time so every file keeps its own size limit and retry result. */
export async function uploadFile(action: string, entry: UploadEntry): Promise<void> {
	entry.status = 'uploading'
	entry.message = 'Uploading…'
	try {
		validateFilePath(entry.path)
		if (entry.file.size > MAX_FILE_BYTES) throw new Error('Choose a file no larger than 10 MiB.')
		const body = new FormData()
		body.set('file', entry.file)
		body.set('path', entry.path)
		if (entry.replace) body.set('replace', 'yes')
		let response: Response
		try {
			response = await fetch(action, {
				method: 'POST',
				body,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
			})
		} catch {
			throw new Error('Couldn’t connect. Check your connection and retry.')
		}
		if (response.status === 413) throw new Error('The upload was too large. Choose a smaller file.')
		let result
		try {
			result = deserialize<{ success?: string }, { error?: string }>(await response.text())
		} catch {
			throw new Error('Couldn’t confirm the upload. Retry to check whether the file was saved.')
		}
		if (result.type === 'success') {
			entry.status = 'uploaded'
			entry.message = 'Uploaded'
		} else if (result.type === 'failure' && result.status === 409) {
			entry.status = 'conflict'
			entry.message = 'A file with this name already exists.'
		} else if (result.type === 'redirect' || result.status === 401) {
			throw new Error('Your session expired. Sign in and retry.')
		} else {
			throw new Error(
				result.type === 'failure'
					? (result.data?.error ?? 'Upload failed. Please retry.')
					: 'Upload failed. Please retry.'
			)
		}
	} catch (error) {
		entry.status = 'failed'
		entry.message = error instanceof Error ? error.message : 'Upload failed. Please retry.'
	}
}
