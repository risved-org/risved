import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRows: Record<string, unknown[]> = {
	cronJobs: [{ id: 'cron-1', projectId: 'proj-1', name: 'Daily job', schedule: '0 * * * *' }],
	cronRuns: [{ id: 'run-1', cronJobId: 'cron-1', startedAt: '2024-01-01', status: 'success' }]
}

function makeChain(tableName: string) {
	const rows = mockRows[tableName] ?? []
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockImplementation(() => chain)
	chain.where = vi.fn().mockImplementation(() => chain)
	chain.orderBy = vi.fn().mockImplementation(() => chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockDb = {
	select: vi.fn().mockImplementation(() => {
		const chain: Record<string, unknown> = {}
		chain.from = vi.fn().mockImplementation((table: unknown) => {
			if (table === (schema.cronJobs as unknown)) return makeChain('cronJobs')
			if (table === (schema.cronRuns as unknown)) return makeChain('cronRuns')
			return makeChain('cronJobs')
		})
		return chain
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

import * as schema from '$lib/server/db/schema'
vi.mock('$lib/server/db/schema', async () => ({
	cronJobs: { id: 'id', projectId: 'project_id' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	desc: vi.fn()
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		params: { id: 'proj-1', cronId: 'cron-1' },
		locals: { user: { id: 'user-1' }, session: {} },
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1/runs'),
		url: new URL('http://localhost/api/projects/proj-1/crons/cron-1/runs'),
		...overrides
	}
}

describe('GET /api/projects/:id/crons/:cronId/runs', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1', name: 'Daily job' }]
		mockRows.cronRuns = [{ id: 'run-1', cronJobId: 'cron-1', status: 'success' }]
	})

	it('returns 200 with run history for a known cron job', async () => {
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(Array.isArray(data)).toBe(true)
	})

	it('returns 404 when cron job is not found', async () => {
		mockRows.cronJobs = []
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('returns empty array when no runs exist', async () => {
		mockRows.cronRuns = []
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toHaveLength(0)
	})
})
