import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.orderBy = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockDb = { select: vi.fn() }

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), desc: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(params = { id: 'proj-1', cronId: 'cron-1' }) {
	return {
		request: new Request('http://localhost/'),
		locals: { user: { id: 'user-1' }, session: {} },
		params,
		url: new URL('http://localhost/')
	}
}

function setupSelectSequence(...rowSets: unknown[][]) {
	let call = 0
	mockDb.select.mockImplementation(() => {
		const rows = rowSets[call] ?? []
		call++
		return makeSelectChain(rows)
	})
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/crons/:cronId/runs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when cron job not found', async () => {
		setupSelectSequence([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('returns 200 with run list', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1' }
		const runs = [
			{ id: 'run-1', cronJobId: 'cron-1', status: 'success' },
			{ id: 'run-2', cronJobId: 'cron-1', status: 'failure' }
		]
		setupSelectSequence([job], runs)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toHaveLength(2)
	})

	it('returns empty array when no runs exist', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1' }
		setupSelectSequence([job], [])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toHaveLength(0)
	})
})
