import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mock data ─────────────────────────────────────────────────────── */

const mockJob = {
	id: 'cron-1',
	projectId: 'proj-1',
	name: 'Daily cleanup',
	route: '/api/cron/cleanup',
	method: 'GET',
	schedule: '0 3 * * *',
	timezone: 'UTC',
	enabled: true
}

/* ── Mock DB ────────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

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

function makeUpdateChain() {
	return {
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	}
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

const mockScheduler = {
	register: vi.fn(),
	unregister: vi.fn()
}

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue(mockScheduler)
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	desc: vi.fn()
}))

/* ── Helpers ─────────────────────────────────────────────────────────── */

function makeEvent(method: string, body?: unknown) {
	return {
		request: new Request('http://localhost/', {
			method,
			...(body
				? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
				: {})
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', cronId: 'cron-1' },
		url: new URL('http://localhost/')
	}
}

/* ── GET ─────────────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 200 with job and runs', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([mockJob]))
			.mockReturnValueOnce(makeSelectChain([]))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent('GET') as never)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.id).toBe('cron-1')
		expect(Array.isArray(data.runs)).toBe(true)
	})

	it('returns 404 when cron job not found', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([]))

		const { GET } = await import('./+server')
		const res = await GET(makeEvent('GET') as never)

		expect(res.status).toBe(404)
	})
})

/* ── PUT ─────────────────────────────────────────────────────────────── */

describe('PUT /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 200 with updated job on valid input', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([mockJob]))
			.mockReturnValueOnce(makeSelectChain([mockJob]))
		mockDb.update.mockReturnValue(makeUpdateChain())

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { name: 'Updated name' }) as never)

		expect(res.status).toBe(200)
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('returns 200 and unregisters when enabled is set to false', async () => {
		const disabledJob = { ...mockJob, enabled: false }
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([mockJob]))
			.mockReturnValueOnce(makeSelectChain([disabledJob]))
		mockDb.update.mockReturnValue(makeUpdateChain())

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { enabled: false }) as never)

		expect(res.status).toBe(200)
		expect(mockScheduler.unregister).toHaveBeenCalledWith('cron-1')
	})

	it('returns 404 when cron job not found', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { name: 'X' }) as never)

		expect(res.status).toBe(404)
	})

	it('returns 400 for invalid JSON body', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const event = {
			...makeEvent('PUT'),
			request: new Request('http://localhost/', { method: 'PUT', body: 'not-json' })
		}
		const res = await PUT(event as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 for empty name', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { name: '   ' }) as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 for name exceeding max length', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { name: 'x'.repeat(101) }) as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 for route without leading slash', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { route: 'api/cron' }) as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid method', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { method: 'DELETE' }) as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid cron expression', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { schedule: 'not-a-cron' }) as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid timezone', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { timezone: 'Not/A/Timezone' }) as never)

		expect(res.status).toBe(400)
	})

	it('returns 400 when enabled is not a boolean', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent('PUT', { enabled: 'yes' }) as never)

		expect(res.status).toBe(400)
	})
})

/* ── DELETE ──────────────────────────────────────────────────────────── */

describe('DELETE /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 200 with success on valid delete', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent('DELETE') as never)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.success).toBe(true)
		expect(mockDb.delete).toHaveBeenCalledTimes(2)
		expect(mockScheduler.unregister).toHaveBeenCalledWith('cron-1')
	})

	it('returns 404 when cron job not found', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([]))

		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent('DELETE') as never)

		expect(res.status).toBe(404)
	})
})
