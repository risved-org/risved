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
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: vi.fn()
}))

import { getProjectMetrics } from '$lib/server/metrics'

function makeEvent(overrides: { params?: Record<string, string>; searchParams?: Record<string, string> } = {}) {
	const searchParams = new URLSearchParams(overrides.searchParams ?? {})
	return {
		locals: {},
		params: { id: 'proj-1', ...overrides.params },
		url: new URL(`http://localhost/api/projects/proj-1/metrics?${searchParams}`)
	}
}

describe('GET /api/projects/:id/metrics', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns metrics for an existing project', async () => {
		const metrics = [{ ts: '2024-01-01', cpu: 0.5, mem: 256 }]
		setupSelectChain([{ id: 'proj-1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue(metrics as ReturnType<typeof getProjectMetrics> extends Promise<infer T> ? T : never)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as Parameters<typeof GET>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.metrics).toEqual(metrics)
	})

	it('returns 404 for unknown project', async () => {
		setupSelectChain([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ params: { id: 'nope' } }) as Parameters<typeof GET>[0])

		expect(res.status).toBe(404)
	})

	it('caps the hours parameter at 168', async () => {
		setupSelectChain([{ id: 'proj-1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({ searchParams: { hours: '9999' } }) as Parameters<typeof GET>[0])

		const calls = vi.mocked(getProjectMetrics).mock.calls
		expect(calls[0][1]).toBe(168)
	})

	it('defaults hours to 24', async () => {
		setupSelectChain([{ id: 'proj-1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent() as Parameters<typeof GET>[0])

		const calls = vi.mocked(getProjectMetrics).mock.calls
		expect(calls[0][1]).toBe(24)
	})
})
