import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ─────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), desc: vi.fn() }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

function makeEvent(params: Record<string, string> = {}) {
	return {
		locals: {},
		params: { id: 'proj-1', cronId: 'cron-1', ...params },
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1/runs')
	}
}

describe('GET /api/projects/:id/crons/:cronId/runs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns run history for a known cron job', async () => {
		const runs = [{ id: 'r1', cronJobId: 'cron-1', status: 'success' }]
		let callCount = 0
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockImplementation(() => {
						callCount++
						return Promise.resolve(callCount === 1 ? [{ id: 'cron-1' }] : runs)
					}),
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue(runs)
					})
				}),
				orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(runs) })
			})
		}))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as Parameters<typeof GET>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual(runs)
	})

	it('returns 404 for unknown cron job', async () => {
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([]),
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
				}),
				orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		}))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ cronId: 'nope' }) as Parameters<typeof GET>[0])

		expect(res.status).toBe(404)
	})
})
