import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockScheduler = {
	execute: vi.fn()
}

const mockDb = { select: vi.fn() }

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn(() => mockScheduler)
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(params = { id: 'proj-1', cronId: 'cron-1' }) {
	return {
		request: new Request('http://localhost/', { method: 'POST' }),
		locals: { user: { id: 'user-1' }, session: {} },
		params,
		url: new URL('http://localhost/')
	}
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue(makeSelectChain(rows))
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('POST /api/projects/:id/crons/:cronId/trigger', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when cron job not found', async () => {
		setupSelect([])

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('returns 400 when no live deployment to execute against', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1' }
		setupSelect([job])
		mockScheduler.execute.mockResolvedValue(null)

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(400)
	})

	it('returns 200 with trigger result on success', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1' }
		setupSelect([job])
		mockScheduler.execute.mockResolvedValue({ status: 'success', statusCode: 200 })

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.triggered).toBe(true)
		expect(data.result.status).toBe('success')
	})
})
