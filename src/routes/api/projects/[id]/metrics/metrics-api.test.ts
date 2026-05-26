import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockGetProjectMetrics = vi.fn()
const mockDb = { select: vi.fn() }

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: mockGetProjectMetrics
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(searchParams = '') {
	return {
		request: new Request('http://localhost/'),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1' },
		url: new URL(`http://localhost/?${searchParams}`)
	}
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue(makeSelectChain(rows))
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/metrics', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when project not found', async () => {
		setupSelect([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('returns metrics with default 24h window', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		const metrics = [{ ts: 1, cpu: 0.5 }]
		setupSelect([project])
		mockGetProjectMetrics.mockResolvedValue(metrics)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.metrics).toEqual(metrics)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 24)
	})

	it('respects custom hours param (capped at 168)', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		setupSelect([project])
		mockGetProjectMetrics.mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent('hours=9999') as never)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 168)
	})

	it('falls back to 24h for non-numeric hours param', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		setupSelect([project])
		mockGetProjectMetrics.mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent('hours=abc') as never)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 24)
	})
})
