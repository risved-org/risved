import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
	select: vi.fn()
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn()
}))

const mockGetProjectMetrics = vi.fn().mockResolvedValue([{ ts: '2024-01-01', cpu: 10, mem: 200 }])

vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: mockGetProjectMetrics
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		params: { id: 'proj-1' },
		url: new URL('http://localhost/api/projects/proj-1/metrics'),
		locals: { user: { id: 'user-1' }, session: {} },
		request: new Request('http://localhost/api/projects/proj-1/metrics'),
		...overrides
	}
}

describe('GET /api/projects/:id/metrics', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns 200 with metrics for an existing project', async () => {
		setupSelect([{ id: 'proj-1' }])
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.metrics).toBeDefined()
		expect(Array.isArray(data.metrics)).toBe(true)
	})

	it('returns 404 for unknown project', async () => {
		setupSelect([])
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('uses default hours of 24', async () => {
		setupSelect([{ id: 'proj-1' }])
		const { GET } = await import('./+server')
		await GET(makeEvent() as never)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 24)
	})

	it('respects hours query param', async () => {
		setupSelect([{ id: 'proj-1' }])
		const { GET } = await import('./+server')
		await GET(
			makeEvent({
				url: new URL('http://localhost/api/projects/proj-1/metrics?hours=48')
			}) as never
		)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 48)
	})

	it('clamps hours to 168', async () => {
		setupSelect([{ id: 'proj-1' }])
		const { GET } = await import('./+server')
		await GET(
			makeEvent({
				url: new URL('http://localhost/api/projects/proj-1/metrics?hours=9999')
			}) as never
		)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 168)
	})
})
