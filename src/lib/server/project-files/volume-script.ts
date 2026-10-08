/** Runs inside a Linux helper with only the project's data volume mounted. */
export const volumeScript = String.raw`
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_CREAT, O_EXCL, O_WRONLY } = fs.constants

/** Pin each directory to an open descriptor so renames and symlinks cannot redirect traversal. */
function directory(parts, create) {
	let fd = fs.openSync('/data', O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
	try {
		for (const part of parts) {
			const next = '/proc/self/fd/' + fd + '/' + part
			if (create) {
				try {
					fs.mkdirSync(next, { mode: 0o755 })
				} catch (error) {
					if (error.code !== 'EEXIST') throw error
				}
			}
			const child = fs.openSync(next, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
			fs.closeSync(fd)
			fd = child
		}
		return fd
	} catch (error) {
		fs.closeSync(fd)
		throw error
	}
}

/** Scan to the requested page, retaining at most 1,000 entries and one lookahead. */
function list(base, page) {
	const entries = []
	const dir = fs.opendirSync(base)
	const offset = (page - 1) * 1000
	let skipped = 0
	let hasNext = false
	try {
		let entry
		while ((entry = dir.readSync())) {
			if (entry.name.startsWith('.risved-upload-')) continue
			if (entry.isSymbolicLink() || entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) continue
			let stat
			try {
				if (!entry.isFile() && !entry.isDirectory()) {
					stat = fs.lstatSync(base + '/' + entry.name)
					if (!stat.isFile() && !stat.isDirectory()) continue
				}
				if (skipped < offset) {
					skipped++
					continue
				}
				stat ??= fs.lstatSync(base + '/' + entry.name)
			} catch (error) {
				if (error.code === 'ENOENT') continue
				throw error
			}
			if (!stat.isFile() && !stat.isDirectory()) continue
			if (entries.length === 1000) {
				hasNext = true
				break
			}
			entries.push({ name: entry.name, kind: stat.isDirectory() ? 'directory' : 'file', size: stat.size, modifiedAt: stat.mtime.toISOString() })
		}
	} finally {
		dir.closeSync()
	}
	entries.sort((a, b) => a.kind.localeCompare(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	return { entries, page, hasNext }
}

/** Write through a private temporary file, then publish atomically without following links. */
function upload(base, name, input) {
	const target = base + '/' + name
	let existing
	try {
		existing = fs.lstatSync(target)
	} catch (error) {
		if (error.code !== 'ENOENT') throw error
	}
	if (existing && !existing.isFile())
		return { error: 'Only regular files can be replaced.', status: 400 }
	if (existing && !input.replace)
		return {
			error: 'A file already exists at this path. Choose Replace to overwrite it.',
			status: 409
		}
	const bytes = Buffer.from(input.content, 'base64')
	if (bytes.length > 10 * 1024 * 1024)
		return { error: 'Files must be 10 MiB or smaller.', status: 413 }
	const temp = base + '/.risved-upload-' + randomUUID()
	const fd = fs.openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
	try {
		fs.writeFileSync(fd, bytes)
		if (existing) fs.fchownSync(fd, existing.uid, existing.gid)
		fs.fchmodSync(fd, existing ? existing.mode & 0o777 : 0o644)
		fs.fsyncSync(fd)
		if (input.replace) fs.renameSync(temp, target)
		else fs.linkSync(temp, target)
	} finally {
		fs.closeSync(fd)
		try {
			fs.unlinkSync(temp)
		} catch (error) {
			if (error.code !== 'ENOENT') throw error
		}
	}
	return { ok: true }
}

/** Dispatch a validated request received on stdin, never through shell interpolation. */
async function main() {
	let raw = ''
	process.stdin.setEncoding('utf8')
	for await (const chunk of process.stdin) {
		raw += chunk
		if (raw.length > 15 * 1024 * 1024) throw new Error('Request too large')
	}
	const input = JSON.parse(raw)
	const parts = input.path ? input.path.split('/') : []
	if (
		parts.some(
			part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')
		)
	)
		throw new Error('Invalid path')
	const name = input.operation === 'list' ? null : parts.pop()
	if (input.operation !== 'list' && !name) throw new Error('A filename is required')
	const fd = directory(parts, input.operation === 'upload')
	const base = '/proc/self/fd/' + fd
	try {
		if (input.operation === 'list') return list(base, input.page ?? 1)
		if (input.operation === 'upload') return upload(base, name, input)
		if (input.operation === 'delete') {
			if (!fs.lstatSync(base + '/' + name).isFile())
				return { error: 'Only regular files can be deleted.', status: 400 }
			fs.unlinkSync(base + '/' + name)
			return { ok: true }
		}
		throw new Error('Unknown operation')
	} finally {
		fs.closeSync(fd)
	}
}

main()
	.then(result => process.stdout.write(JSON.stringify(result)))
	.catch(error => {
		const known = {
			ENOENT: [404, 'File or folder not found.'],
			EEXIST: [409, 'A file already exists at this path.'],
			ELOOP: [400, 'Symbolic links are not supported.'],
			ENAMETOOLONG: [400, 'A filename or folder name is too long.'],
			ENOTDIR: [400, 'The path contains a file or symbolic link.'],
			ENOSPC: [507, 'The project storage is full.'],
			EACCES: [403, 'The file permissions prevent this operation.']
		}
		const [status, message] = known[error.code] || [500, 'The file operation failed.']
		process.stdout.write(JSON.stringify({ error: message, status }))
	})
`
