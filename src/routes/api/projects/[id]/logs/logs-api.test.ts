import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ─────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			}),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	getContainerLogs: vi.fn()
}))

import { getContainerLogs } from '$lib/server/pipeline/docker'

function makeEvent(overrides: { params?: Record<string, string>; searchParams?: Record<string, string> } = {}) {
	const searchParams = new URLSearchParams(overrides.searchParams ?? {})
	return {
		locals: {},
		params: { id: 'proj-1', ...overrides.params },
		url: new URL(`http://localhost/api/projects/proj-1/logs?${searchParams}`)
	}
}

describe('GET /api/projects/:id/logs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns container logs for an existing project', async () => {
		setupSelectChain([{ id: 'proj-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue('line 1\nline 2')

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as Parameters<typeof GET>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.logs).toBe('line 1\nline 2')
	})

	it('returns 404 for unknown project', async () => {
		setupSelectChain([])

		const { GET } = await import('./+server')
		try {
			await GET(makeEvent({ params: { id: 'nope' } }) as Parameters<typeof GET>[0])
			expect.fail('should have thrown')
		} catch (e: unknown) {
			const err = e as { status?: number }
			expect(err.status).toBe(404)
		}
	})

	it('caps the tail parameter at 1000', async () => {
		setupSelectChain([{ id: 'proj-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue('logs')

		const { GET } = await import('./+server')
		await GET(makeEvent({ searchParams: { tail: '9999' } }) as Parameters<typeof GET>[0])

		const calls = vi.mocked(getContainerLogs).mock.calls
		expect(calls[0][2]).toBe(1000)
	})

	it('defaults tail to 200', async () => {
		setupSelectChain([{ id: 'proj-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue('logs')

		const { GET } = await import('./+server')
		await GET(makeEvent() as Parameters<typeof GET>[0])

		const calls = vi.mocked(getContainerLogs).mock.calls
		expect(calls[0][2]).toBe(200)
	})
})
