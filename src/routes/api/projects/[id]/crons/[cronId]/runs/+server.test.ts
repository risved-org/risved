import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mock DB ────────────────────────────────────────────────────────── */

const mockDb = { select: vi.fn() }

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(rows)
				})
			})
		})
	}
}

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

/* ── Helpers ─────────────────────────────────────────────────────────── */

function makeEvent() {
	return {
		request: new Request('http://localhost/', { method: 'GET' }),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', cronId: 'cron-1' },
		url: new URL('http://localhost/')
	}
}

/* ── Tests ───────────────────────────────────────────────────────────── */

const mockJob = { id: 'cron-1', projectId: 'proj-1' }
const mockRun = { id: 'run-1', cronJobId: 'cron-1', startedAt: new Date().toISOString() }

describe('GET /api/projects/:id/crons/:cronId/runs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 200 with run history', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([mockJob]))
			.mockReturnValueOnce(makeSelectChain([mockRun]))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(Array.isArray(data)).toBe(true)
		expect(data[0].id).toBe('run-1')
	})

	it('returns 200 with empty array when no runs', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([mockJob]))
			.mockReturnValueOnce(makeSelectChain([]))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toEqual([])
	})

	it('returns 404 when cron job not found', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([]))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)

		expect(res.status).toBe(404)
	})
})
