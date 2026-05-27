import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.hoisted(() => ({ select: vi.fn() }))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
}))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: vi.fn()
}))

import { getProjectMetrics } from '$lib/server/metrics'

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

function makeEvent(
	params: Record<string, string> = {},
	searchParams: Record<string, string> = {}
) {
	const url = new URL('http://localhost/api/projects/p-1/metrics')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		locals: { user: { id: 'user-1' } },
		request: { headers: { get: () => null } },
		params: { id: 'p-1', ...params },
		url
	} as never
}

describe('GET /api/projects/[id]/metrics', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns metrics for a project', async () => {
		setupSelectChain([{ id: 'p-1' }])
		const metrics = [{ ts: '2026-01-01', cpu: 5 }]
		vi.mocked(getProjectMetrics).mockResolvedValue(metrics as never)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent())

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.metrics).toEqual(metrics)
		expect(getProjectMetrics).toHaveBeenCalledWith('p-1', 24)
	})

	it('passes custom hours', async () => {
		setupSelectChain([{ id: 'p-1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({}, { hours: '72' }))

		expect(getProjectMetrics).toHaveBeenCalledWith('p-1', 72)
	})

	it('caps hours at 168', async () => {
		setupSelectChain([{ id: 'p-1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({}, { hours: '9999' }))

		expect(getProjectMetrics).toHaveBeenCalledWith('p-1', 168)
	})

	it('returns 404 when project not found', async () => {
		setupSelectChain([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent())

		expect(res.status).toBe(404)
	})
})
