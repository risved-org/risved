import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Mock DB */
const mockRows: Record<string, unknown[]> = {
	projects: [{ id: 'proj-1', slug: 'my-app', port: 8000 }],
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
	chain.returning = vi.fn().mockImplementation(() => Promise.resolve(rows))
	chain.values = vi.fn().mockImplementation((vals: unknown) => {
		const created = { id: 'new-cron-1', ...vals }
		mockRows.cronJobs = [created]
		return { returning: vi.fn().mockResolvedValue([created]) }
	})
	chain.set = vi.fn().mockReturnValue(chain)
	return chain
}

const mockDb = {
	select: vi.fn().mockImplementation(() => {
		const chain: Record<string, unknown> = {}
		chain.from = vi.fn().mockImplementation((table: { id?: string }) => {
			if (table === schema.projects) return makeChain('projects')
			if (table === schema.cronJobs) return makeChain('cronJobs')
			if (table === schema.cronRuns) return makeChain('cronRuns')
			return makeChain('projects')
		})
		return chain
	}),
	insert: vi.fn().mockImplementation(() => ({
		values: vi.fn().mockImplementation((vals: unknown) => {
			const created = { id: 'new-cron-1', ...vals }
			return { returning: vi.fn().mockResolvedValue([created]) }
		})
	})),
	update: vi.fn().mockImplementation(() => makeChain('cronJobs')),
	delete: vi.fn().mockImplementation(() => ({
		where: vi.fn().mockResolvedValue({ rowsAffected: 0 })
	}))
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

import * as schema from '$lib/server/db/schema'
vi.mock('$lib/server/db/schema', async () => {
	const actual: Record<string, unknown> = {
		projects: { id: 'id', slug: 'slug' },
		cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
		cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' },
		deployments: { projectId: 'project_id', status: 'status' }
	}
	return actual
})

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue({
		register: vi.fn(),
		unregister: vi.fn(),
		execute: vi.fn().mockResolvedValue({ status: 'success', statusCode: 200 })
	})
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	desc: vi.fn()
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		request: new Request('http://localhost/api/projects/proj-1/crons', {
			method: 'GET',
			...(overrides.body
				? {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(overrides.body)
					}
				: {})
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', ...(overrides.params as Record<string, string> ?? {}) },
		url: new URL('http://localhost/api/projects/proj-1/crons'),
		...overrides
	}
}

describe('GET /api/projects/:id/crons', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = []
	})

	it('returns 200 with cron jobs list', async () => {
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
	})
})

describe('POST /api/projects/:id/crons', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = []
	})

	it('creates a cron job with valid input', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				body: {
					name: 'Daily cleanup',
					route: '/api/cron/cleanup',
					schedule: '0 3 * * *'
				}
			}) as never
		)
		expect(res.status).toBe(201)
		const data = await res.json()
		expect(data.name).toBe('Daily cleanup')
	})

	it('rejects missing name', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				body: { route: '/api/test', schedule: '0 * * * *' }
			}) as never
		)
		expect(res.status).toBe(400)
	})

	it('rejects route without leading slash', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				body: { name: 'Test', route: 'api/test', schedule: '0 * * * *' }
			}) as never
		)
		expect(res.status).toBe(400)
	})

	it('rejects invalid cron expression', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				body: { name: 'Test', route: '/api/test', schedule: 'not-valid' }
			}) as never
		)
		expect(res.status).toBe(400)
	})

	it('rejects invalid method', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				body: { name: 'Test', route: '/api/test', schedule: '0 * * * *', method: 'DELETE' }
			}) as never
		)
		expect(res.status).toBe(400)
	})
})
