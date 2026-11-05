import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'

/** Normalize the optional app path, rejecting traversal and ambiguous paths. */
export function parseAppDirectory(value: unknown): string | null {
	if (value == null || value === '' || value === '/') return null
	if (typeof value !== 'string') throw new Error('App directory must be a relative path')
	const path = value.trim().replace(/\/+$/, '')
	if (!path) return null
	if (
		path.startsWith('/') ||
		path.split('/').some(part => !part || part === '.' || part === '..') ||
		/[\\:*?"<>|$`]/.test(path) ||
		[...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
	) {
		throw new Error(
			'Enter an app directory relative to the repository, such as apps/web, without ..'
		)
	}
	return path
}

/** Resolve the app within the checkout, including containment after symlink resolution. */
export async function resolveAppDirectory(repo: string, value: string): Promise<string> {
	const path = parseAppDirectory(value)
	try {
		const root = await realpath(repo)
		const app = await realpath(resolve(root, path ?? '.'))
		const fromRoot = relative(root, app)
		if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
			throw new Error('App directory must stay inside the repository')
		}
		if (!(await stat(app)).isDirectory()) throw new Error('Not a directory')
		return app
	} catch (error) {
		if (error instanceof Error && error.message.includes('stay inside')) throw error
		throw new Error(`App directory "${value}" does not exist on this branch`)
	}
}
