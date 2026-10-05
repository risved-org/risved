import { FileOperationError } from './index'
import { MAX_FILE_BYTES } from '$lib/project-files'

/** Bound multipart input before parsing, including requests without Content-Length. */
export async function readFileForm(request: Request): Promise<FormData> {
	const limit = MAX_FILE_BYTES + 64 * 1024
	if (Number(request.headers.get('content-length')) > limit) {
		throw new FileOperationError(413, 'Files must be 10 MiB or smaller.')
	}
	if (!request.body) throw new FileOperationError(400, 'Choose a file to upload.')
	const reader = request.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > limit) {
				await reader.cancel()
				throw new FileOperationError(413, 'Files must be 10 MiB or smaller.')
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	try {
		return await new Response(Buffer.concat(chunks), {
			headers: { 'content-type': request.headers.get('content-type') ?? '' }
		}).formData()
	} catch {
		throw new FileOperationError(400, 'Invalid upload form.')
	}
}
