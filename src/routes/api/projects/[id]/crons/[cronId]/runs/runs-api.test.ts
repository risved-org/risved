import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Mock DB */
const mockRows: Record<string, unknown[]> = {
	cronJobs: [],
	cronRuns: []
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
vi.mock('$lib/server/db/schema', async () => {
	const actual: Record<string, unknown> = {
		cronJobs: { id: 'id', projectId: 'project_id' },
		cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
	}
	return actual
})

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
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1/runs', {
			method: 'GET'
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', cronId: 'cron-1', ...(overrides.params as Record<string, string> ?? {}) },
		url: new URL('http://localhost/api/projects/proj-1/crons/cron-1/runs'),
		...overrides
	}
}

describe('GET /api/projects/:id/crons/:cronId/runs', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = []
		mockRows.cronRuns = []
	})

	it('returns 404 when job not found', async () => {
		mockRows.cronJobs = []
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
		const data = await res.json()
		expect(data.error).toMatch(/cron job not found/i)
	})

	it('returns 200 with runs list', async () => {
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1' }]
		mockRows.cronRuns = [
			{ id: 'run-1', cronJobId: 'cron-1', startedAt: '2024-01-01T00:00:00.000Z' },
			{ id: 'run-2', cronJobId: 'cron-1', startedAt: '2024-01-02T00:00:00.000Z' }
		]
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(Array.isArray(data)).toBe(true)
		expect(data.length).toBe(2)
	})
})
