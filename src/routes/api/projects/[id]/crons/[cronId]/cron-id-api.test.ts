import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRows: Record<string, unknown[]> = {
	cronJobs: [{ id: 'cron-1', projectId: 'proj-1', name: 'Test', route: '/test', schedule: '0 * * * *', enabled: true }],
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
			return makeChain('cronJobs')
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
	Cron: vi.fn().mockImplementation(function() {})
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1', {
			method: 'GET',
			...(overrides.body
				? {
						method: 'PUT',
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

describe('GET /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1', name: 'Test', route: '/test', schedule: '0 * * * *', enabled: true }]
		mockRows.cronRuns = []
	})

	it('returns job and runs when found', async () => {
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.id).toBe('cron-1')
		expect(Array.isArray(data.runs)).toBe(true)
	})

	it('returns 404 when not found', async () => {
		mockRows.cronJobs = []
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
	})
})

describe('PUT /api/projects/:id/crons/:cronId', () => {
	beforeEach(async () => {
		vi.clearAllMocks()
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1', name: 'Test', route: '/test', schedule: '0 * * * *', enabled: true }]
		mockRows.cronRuns = []
		const { Cron } = await import('croner')
		vi.mocked(Cron).mockImplementation(function() {} as never)
	})

	it('updates name successfully', async () => {
		const updated = { id: 'cron-1', projectId: 'proj-1', name: 'Updated', route: '/test', schedule: '0 * * * *', enabled: true }
		mockDb.select.mockImplementationOnce(() => {
			const chain: Record<string, unknown> = {}
			chain.from = vi.fn().mockImplementation(() => makeChain('cronJobs'))
			return chain
		}).mockImplementationOnce(() => {
			const rows = [updated]
			const chain: Record<string, unknown> = {}
			chain.from = vi.fn().mockImplementation(() => {
				const c: Record<string, unknown> = {}
				c.where = vi.fn().mockReturnValue(c)
				c.limit = vi.fn().mockResolvedValue(rows)
				return c
			})
			return chain
		})
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: 'Updated' } }) as never)
		expect(res.status).toBe(200)
	})

	it('updates route successfully', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { route: '/new-route' } }) as never)
		expect(res.status).toBe(200)
	})

	it('updates method successfully', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { method: 'POST' } }) as never)
		expect(res.status).toBe(200)
	})

	it('updates schedule successfully', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { schedule: '0 0 * * *' } }) as never)
		expect(res.status).toBe(200)
	})

	it('updates timezone successfully', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { timezone: 'America/New_York' } }) as never)
		expect(res.status).toBe(200)
	})

	it('updates enabled successfully', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { enabled: false } }) as never)
		expect(res.status).toBe(200)
	})

	it('returns 404 when cron not found', async () => {
		mockRows.cronJobs = []
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: 'X' } }) as never)
		expect(res.status).toBe(404)
	})

	it('returns 400 for empty name', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: '' } }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for whitespace-only name', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { name: '   ' } }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for route without leading slash', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { route: 'no-slash' } }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid method', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { method: 'DELETE' } }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid cron expression', async () => {
		const { Cron } = await import('croner')
		vi.mocked(Cron).mockImplementationOnce(function() { throw new Error('invalid') } as never)
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { schedule: 'not-valid' } }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid timezone', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { timezone: 'Not/AReal/Timezone' } }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for non-boolean enabled', async () => {
		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ body: { enabled: 'yes' } }) as never)
		expect(res.status).toBe(400)
	})
})

describe('DELETE /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1', name: 'Test', route: '/test', schedule: '0 * * * *', enabled: true }]
		mockRows.cronRuns = []
	})

	it('deletes cron job and returns success', async () => {
		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.success).toBe(true)
	})

	it('returns 404 when not found', async () => {
		mockRows.cronJobs = []
		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent() as never)
		expect(res.status).toBe(404)
	})
})
