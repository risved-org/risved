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
	chain.set = vi.fn().mockReturnValue(chain)
	return chain
}

const mockDb = {
	select: vi.fn().mockImplementation(() => {
		const chain: Record<string, unknown> = {}
		chain.from = vi.fn().mockImplementation((table: unknown) => {
			if (table === (schema.cronJobs as unknown)) return makeChain('cronJobs')
			if (table === (schema.cronRuns as unknown)) return makeChain('cronRuns')
			return makeChain('projects')
		})
		return chain
	}),
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

vi.mock('croner', () => ({
	Cron: vi.fn().mockImplementation((expr: string) => {
		if (expr === 'not-valid') throw new Error('Invalid cron expression')
	})
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	const method = overrides.method as string ?? 'GET'
	const hasBody = !!overrides.body
	return {
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1', {
			method: hasBody ? (overrides.method as string ?? 'PUT') : method,
			...(hasBody
				? {
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(overrides.body)
					}
				: {})
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', cronId: 'cron-1', ...(overrides.params as Record<string, string> ?? {}) },
		url: new URL('http://localhost/api/projects/proj-1/crons/cron-1'),
		...overrides
	}
}

const baseJob = {
	id: 'cron-1',
	projectId: 'proj-1',
	name: 'My Cron',
	route: '/api/cron/test',
	method: 'GET',
	schedule: '0 * * * *',
	timezone: 'UTC',
	enabled: true,
	updatedAt: '2024-01-01T00:00:00.000Z'
}

describe('GET /api/projects/:id/crons/:cronId', () => {
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
	})

	it('returns 200 with job and runs when found', async () => {
		mockRows.cronJobs = [baseJob]
		mockRows.cronRuns = [{ id: 'run-1', cronJobId: 'cron-1', startedAt: '2024-01-01T00:00:00.000Z' }]
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.id).toBe('cron-1')
		expect(Array.isArray(data.runs)).toBe(true)
	})
})

describe('PUT /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = []
		mockRows.cronRuns = []
	})

	it('returns 404 when job not found', async () => {
		mockRows.cronJobs = []
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: 'Updated' } }) as never)
		expect(res.status).toBe(404)
	})

	it('returns 400 for invalid JSON body', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT({
			request: {
				json: () => Promise.reject(new Error('bad json'))
			},
			locals: { user: { id: 'user-1' }, session: {} },
			params: { id: 'proj-1', cronId: 'cron-1' }
		} as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for empty name', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: '   ' } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/non-empty/i)
	})

	it('returns 400 for name too long', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: 'a'.repeat(101) } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/100 characters/i)
	})

	it('returns 400 for route not starting with /', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { route: 'api/test' } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/route must start with \//i)
	})

	it('returns 400 for invalid method', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { method: 'DELETE' } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/method must be GET or POST/i)
	})

	it('returns 400 for invalid cron expression', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { schedule: 'not-valid' } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/invalid cron/i)
	})

	it('returns 400 for invalid timezone', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { timezone: 'Not/AReal/Zone' } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/invalid timezone/i)
	})

	it('returns 400 when enabled is not boolean', async () => {
		mockRows.cronJobs = [baseJob]
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { enabled: 'yes' } }) as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/enabled must be a boolean/i)
	})

	it('returns 200 and registers when enabled=true', async () => {
		mockRows.cronJobs = [{ ...baseJob, enabled: true }]
		const { PUT } = await import('./+server')
		const { getCronScheduler } = await import('$lib/server/cron')
		const scheduler = getCronScheduler()
		const res = await PUT(makeEvent({ body: { enabled: true } }) as never)
		expect(res.status).toBe(200)
		expect(scheduler.register).toHaveBeenCalled()
	})

	it('returns 200 and unregisters when enabled=false', async () => {
		mockRows.cronJobs = [{ ...baseJob, enabled: false }]
		const { PUT } = await import('./+server')
		const { getCronScheduler } = await import('$lib/server/cron')
		const scheduler = getCronScheduler()
		const res = await PUT(makeEvent({ body: { enabled: false } }) as never)
		expect(res.status).toBe(200)
		expect(scheduler.unregister).toHaveBeenCalled()
	})
})

describe('DELETE /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = []
		mockRows.cronRuns = []
	})

	it('returns 404 when job not found', async () => {
		mockRows.cronJobs = []
		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('returns 200 and unregisters/deletes', async () => {
		mockRows.cronJobs = [baseJob]
		const { DELETE } = await import('./+server')
		const { getCronScheduler } = await import('$lib/server/cron')
		const scheduler = getCronScheduler()
		const res = await DELETE(makeEvent() as never)
		expect(res.status).toBe(200)
		expect(scheduler.unregister).toHaveBeenCalledWith('cron-1')
		const data = await res.json()
		expect(data.success).toBe(true)
	})
})
