export const MAX_FILE_BYTES = 10 * 1024 * 1024

export interface ProjectFile {
	name: string
	kind: 'file' | 'directory'
	size: number
	modifiedAt: string
}

/** Accept only relative paths that stay inside the project's data volume. */
export function validateFilePath(path: string, allowRoot = false): string {
	if (allowRoot && path === '') return path
	if (
		!path ||
		path.length > 1024 ||
		path
			.split('/')
			.some(
				part =>
					!part ||
					part === '.' ||
					part === '..' ||
					part.length > 255 ||
					part.startsWith('.risved-upload-')
			) ||
		/\\/.test(path) ||
		Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
	)
		throw new Error('Use a relative path such as fonts/example.woff2, without .. or empty folders.')
	return path
}
