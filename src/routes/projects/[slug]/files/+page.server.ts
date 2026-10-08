import { error, fail } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { db } from '$lib/server/db'
import { projects } from '$lib/server/db/schema'
import { requireAuth } from '$lib/server/api-utils'
import { projectFiles, FileOperationError } from '$lib/server/project-files'
import { readFileForm } from '$lib/server/project-files/form'
import { MAX_FILE_BYTES } from '$lib/project-files'
import type { RequestEvent } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'

/** Authenticate before resolving the project for any storage operation. */
async function findProject(event: RequestEvent, mutation = false) {
	await requireAuth(event)
	if (mutation && event.request.headers.get('origin') !== event.url.origin) {
		error(403, 'Cross-origin file operations are not allowed')
	}
	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.slug, event.params.slug!))
		.limit(1)
	if (!project) error(404, 'Project not found')
	return project
}

/** Keep helper failures actionable without exposing system paths or file contents. */
function failure(cause: unknown) {
	return cause instanceof FileOperationError
		? { status: cause.status, message: cause.message }
		: { status: 500, message: 'The file operation failed. Please try again.' }
}

export const load: PageServerLoad = async event => {
	const project = await findProject(event)
	const directory = event.url.searchParams.get('directory') ?? ''
	try {
		const result = await projectFiles(project.id, {
			operation: 'list',
			path: directory,
			page: Number(event.url.searchParams.get('page') ?? '1')
		})
		return {
			directory,
			entries: result.entries ?? [],
			page: result.page ?? 1,
			hasNext: result.hasNext ?? false,
			storageError: null
		}
	} catch (cause) {
		return { directory, entries: [], page: 1, hasNext: false, storageError: failure(cause).message }
	}
}

export const actions: Actions = {
	upload: async event => {
		const project = await findProject(event, true)
		try {
			const form = await readFileForm(event.request)
			if (form.getAll('file').length !== 1)
				return fail(400, { error: 'Send one file per upload request.' })
			const file = form.get('file')
			if (!file || typeof file === 'string' || !file.name)
				return fail(400, { error: 'Choose a file to upload.' })
			if (file.size > MAX_FILE_BYTES)
				return fail(413, { error: 'Files must be 10 MiB or smaller.' })
			const path = form.get('path')
			if (typeof path !== 'string' || !path)
				return fail(400, { error: 'Enter the destination path.' })
			await projectFiles(project.id, {
				operation: 'upload',
				path,
				content: Buffer.from(await file.arrayBuffer()).toString('base64'),
				replace: form.get('replace') === 'yes'
			})
			return { success: `Saved /app/data/${path}` }
		} catch (cause) {
			const result = failure(cause)
			return fail(result.status, { error: result.message })
		}
	},
	delete: async event => {
		const project = await findProject(event, true)
		try {
			const form = await readFileForm(event.request)
			const path = form.get('path')
			if (typeof path !== 'string' || form.get('confirm') !== 'yes')
				return fail(400, { error: 'Confirm the file deletion.' })
			await projectFiles(project.id, { operation: 'delete', path })
			return { success: `Deleted /app/data/${path}` }
		} catch (cause) {
			const result = failure(cause)
			return fail(result.status, { error: result.message })
		}
	}
}
