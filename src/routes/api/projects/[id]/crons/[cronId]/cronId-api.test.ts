import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ─────────────────────────────────────────────────────── */

const mockScheduler = {
	register: vi.fn(),
	unregister: vi.fn(),
	execute: vi.fn()
}

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' },
	cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), desc: vi.fn() }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn()
}))
vi.mock('croner', () => ({
	Cron: vi.fn().mockImplementation(() => ({}))
}))

import { getCronScheduler } from '$lib/server/cron'

const baseJob = { id: 'cron-1', projectId: 'proj-1', name: 'Ping', enabled: true, schedule: '* * * * *' }

function setupSelect(jobs: unknown[], runs: unknown[] = []) {
	let callCount = 0
	mockDb.select.mockImplementation(() => ({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockImplementation(() => {
					callCount++
					return Promise.resolve(callCount === 1 ? jobs : runs)
				}),
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(runs)
				})
			}),
			orderBy: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(runs)
			})
		})
	}))
}

function makeEvent(overrides: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
	const { method = 'GET', body, params = {} } = overrides
	return {
		locals: {},
		params: { id: 'proj-1', cronId: 'cron-1', ...params },
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		})
	}
}

/* ── GET /api/projects/:id/crons/:cronId ─────────────────────── */

describe('GET /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCronScheduler).mockReturnValue(mockScheduler as ReturnType<typeof getCronScheduler>)
	})

	it('returns job with recent runs', async () => {
		const runs = [{ id: 'r1', cronJobId: 'cron-1', status: 'success' }]
		setupSelect([baseJob], runs)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as Parameters<typeof GET>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.id).toBe('cron-1')
		expect(body.runs).toEqual(runs)
	})

	it('returns 404 for unknown cron job', async () => {
		setupSelect([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ params: { cronId: 'nope' } }) as Parameters<typeof GET>[0])

		expect(res.status).toBe(404)
	})
})

/* ── PUT /api/projects/:id/crons/:cronId ────────────────────── */

describe('PUT /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCronScheduler).mockReturnValue(mockScheduler as ReturnType<typeof getCronScheduler>)
	})

	it('updates allowed fields and re-registers if enabled', async () => {
		const updated = { ...baseJob, name: 'Updated' }
		setupSelect([baseJob])
		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue({ rowsAffected: 1 })
			})
		})
		/* Second select returns updated job */
		let calls = 0
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockImplementation(() => {
						calls++
						return Promise.resolve(calls === 1 ? [baseJob] : [updated])
					}),
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
				}),
				orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		}))

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ method: 'PUT', body: { name: 'Updated', enabled: true } }) as Parameters<typeof PUT>[0])

		expect(res.status).toBe(200)
		expect(mockScheduler.register).toHaveBeenCalledWith(updated)
	})

	it('returns 404 for unknown cron job', async () => {
		setupSelect([])

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ method: 'PUT', body: {} }) as Parameters<typeof PUT>[0])

		expect(res.status).toBe(404)
	})

	it('returns 400 for invalid JSON body', async () => {
		setupSelect([baseJob])

		const { PUT } = await import('./+server')
		const event = {
			locals: {},
			params: { id: 'proj-1', cronId: 'cron-1' },
			request: new Request('http://localhost/', { method: 'PUT', body: 'bad json' })
		}
		const res = await PUT(event as Parameters<typeof PUT>[0])
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid schedule expression', async () => {
		setupSelect([baseJob])

		const { Cron } = await import('croner')
		vi.mocked(Cron).mockImplementationOnce(() => { throw new Error('bad') })

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ method: 'PUT', body: { schedule: 'not-a-cron' } }) as Parameters<typeof PUT>[0])

		expect(res.status).toBe(400)
	})

	it('unregisters scheduler when enabled set to false', async () => {
		const disabledJob = { ...baseJob, enabled: false }
		let calls = 0
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockImplementation(() => {
						calls++
						return Promise.resolve(calls === 1 ? [baseJob] : [disabledJob])
					}),
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
				}),
				orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		}))
		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue({ rowsAffected: 1 })
			})
		})

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ method: 'PUT', body: { enabled: false } }) as Parameters<typeof PUT>[0])

		expect(res.status).toBe(200)
		expect(mockScheduler.unregister).toHaveBeenCalledWith('cron-1')
	})
})

/* ── DELETE /api/projects/:id/crons/:cronId ─────────────────── */

describe('DELETE /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCronScheduler).mockReturnValue(mockScheduler as ReturnType<typeof getCronScheduler>)
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) })
	})

	it('deletes job and its runs', async () => {
		setupSelect([baseJob])

		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent({ method: 'DELETE' }) as Parameters<typeof DELETE>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.success).toBe(true)
		expect(mockScheduler.unregister).toHaveBeenCalledWith('cron-1')
		expect(mockDb.delete).toHaveBeenCalledTimes(2)
	})

	it('returns 404 for unknown cron job', async () => {
		setupSelect([])

		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent({ method: 'DELETE' }) as Parameters<typeof DELETE>[0])

		expect(res.status).toBe(404)
	})
})
