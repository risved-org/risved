import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn() } }))
vi.mock('$lib/server/api-utils', () => ({ requireAuth: vi.fn() }))
vi.mock('$lib/server/project-files', async importOriginal => ({
	...(await importOriginal<typeof import('$lib/server/project-files')>()),
	projectFiles: vi.fn()
}))

import { db } from '$lib/server/db'
import { requireAuth } from '$lib/server/api-utils'
import { projectFiles, FileOperationError } from '$lib/server/project-files'
import { actions, load } from './+page.server'

/** Construct a multipart request without touching the live database or Docker. */
function event(values: Record<string, string | File> = {}) {
	const form = new FormData()
	for (const [key, value] of Object.entries(values)) form.set(key, value)
	return {
		params: { slug: 'demo' },
		locals: {},
		url: new URL('http://localhost/projects/demo/files'),
		request: new Request('http://localhost/projects/demo/files', {
			method: 'POST',
			body: form,
			headers: { origin: 'http://localhost' }
		})
	} as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(db.select).mockReturnValue({
		from: () => ({ where: () => ({ limit: async () => [{ id: 'immutable-project-id' }] }) })
	} as never)
	vi.mocked(projectFiles).mockResolvedValue({ entries: [] })
})

describe('project Files page', () => {
	it('passes the selected folder and page to storage and returns pagination', async () => {
		const request = event()
		request.url.searchParams.set('directory', 'fonts')
		request.url.searchParams.set('page', '2')
		vi.mocked(projectFiles).mockResolvedValue({ entries: [], page: 2, hasNext: true })
		expect(await load(request)).toMatchObject({ directory: 'fonts', page: 2, hasNext: true })
		expect(projectFiles).toHaveBeenCalledWith('immutable-project-id', {
			operation: 'list',
			path: 'fonts',
			page: 2
		})
	})
	it('rejects multiple files in one request instead of silently dropping extra files', async () => {
		const request = event({ path: 'fonts/a', file: new File(['a'], 'a') })
		const form = await request.request.formData()
		form.append('file', new File(['b'], 'b'))
		request.request = new Request(request.url, {
			method: 'POST',
			body: form,
			headers: { origin: request.url.origin }
		})
		expect(await actions.upload(request as never)).toMatchObject({ status: 400 })
		expect(projectFiles).not.toHaveBeenCalled()
	})
	it.each(['upload', 'delete'])(
		'rejects cross-origin %s before touching the database or storage',
		async operation => {
			const request = event()
			request.request.headers.set('origin', 'https://untrusted.example')
			await expect(actions[operation](request as never)).rejects.toMatchObject({ status: 403 })
			expect(db.select).not.toHaveBeenCalled()
			expect(projectFiles).not.toHaveBeenCalled()
		}
	)
	it.each(['load', 'upload', 'delete'])(
		'authenticates before %s or looking up a project',
		async operation => {
			vi.mocked(requireAuth).mockRejectedValue({ status: 401 })
			const handler = operation === 'load' ? load : actions[operation]
			await expect(handler(event() as never)).rejects.toMatchObject({ status: 401 })
			expect(db.select).not.toHaveBeenCalled()
			expect(projectFiles).not.toHaveBeenCalled()
		}
	)
	it('rejects missing projects before touching storage', async () => {
		vi.mocked(db.select).mockReturnValue({
			from: () => ({ where: () => ({ limit: async () => [] }) })
		} as never)
		await expect(actions.upload(event() as never)).rejects.toMatchObject({ status: 404 })
		expect(projectFiles).not.toHaveBeenCalled()
	})
	it('uploads binary files to the immutable project ID without implicit replacement', async () => {
		const result = await actions.upload(
			event({
				path: 'private/bank.key',
				file: new File([new Uint8Array([255, 0])], 'bank.key')
			}) as never
		)
		expect(projectFiles).toHaveBeenCalledWith('immutable-project-id', {
			operation: 'upload',
			path: 'private/bank.key',
			content: '/wA=',
			replace: false
		})
		expect(result).toEqual({ success: 'Saved /app/data/private/bank.key' })
	})
	it('surfaces conflicts and preserves files unless replacement is explicit', async () => {
		vi.mocked(projectFiles).mockRejectedValue(new FileOperationError(409, 'Already exists'))
		const result = await actions.upload(
			event({ path: 'font.woff2', file: new File(['font'], 'font.woff2') }) as never
		)
		expect(result).toMatchObject({ status: 409, data: { error: 'Already exists' } })
	})
	it('requires deletion confirmation', async () => {
		const result = await actions.delete(event({ path: 'bank.key' }) as never)
		expect(result).toMatchObject({ status: 400 })
		expect(projectFiles).not.toHaveBeenCalled()
	})
	it('allows an explicitly confirmed deletion', async () => {
		await actions.delete(event({ path: 'bank.key', confirm: 'yes' }) as never)
		expect(projectFiles).toHaveBeenCalledWith('immutable-project-id', {
			operation: 'delete',
			path: 'bank.key'
		})
	})
	it('shows storage outages without crashing the page', async () => {
		vi.mocked(projectFiles).mockRejectedValue(new FileOperationError(503, 'Storage unavailable'))
		expect(await load(event())).toMatchObject({ entries: [], storageError: 'Storage unavailable' })
	})
})
