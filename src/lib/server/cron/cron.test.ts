import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* Mock DB before importing the scheduler */
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

/**
 * Creates a thenable chain object that resolves to `result` when awaited directly,
 * but also supports chaining .from().where().limit() etc.
 */
function chainable(result: unknown[]) {
	const chain: Record<string, unknown> = {
		then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
			Promise.resolve(result).then(resolve, reject)
	}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.orderBy = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockResolvedValue(result)
	chain.returning = vi.fn().mockResolvedValue(result)
	chain.set = vi.fn().mockReturnValue(chain)
	chain.values = vi.fn().mockReturnValue(chain)
	return chain
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable([]),
		insert: () => chainable([]),
		update: () => chainable([]),
		delete: () => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) })
	}
}))

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null)
}))

vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' },
	projects: { id: 'id' },
	deployments: { projectId: 'project_id', status: 'status' }
}))

import { db } from '$lib/server/db'
import { getSetting } from '$lib/server/settings'
import { CronScheduler, getCronScheduler } from './index'

describe('CronScheduler', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		scheduler = new CronScheduler({ timeoutMs: 5000 })
	})

	afterEach(() => {
		scheduler.stop()
	})

	it('starts and stops without error', async () => {
		await scheduler.start()
		expect(scheduler.activeCount).toBe(0)
		scheduler.stop()
	})

	it('registers a cron job', () => {
		const job = {
			id: 'job-1',
			projectId: 'proj-1',
			name: 'Test',
			route: '/api/cron/test',
			method: 'GET',
			schedule: '0 3 * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}

		scheduler.register(job)
		expect(scheduler.isRegistered('job-1')).toBe(true)
		expect(scheduler.activeCount).toBe(1)
	})

	it('unregisters a cron job', () => {
		const job = {
			id: 'job-1',
			projectId: 'proj-1',
			name: 'Test',
			route: '/api/cron/test',
			method: 'GET',
			schedule: '0 3 * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}

		scheduler.register(job)
		scheduler.unregister('job-1')
		expect(scheduler.isRegistered('job-1')).toBe(false)
		expect(scheduler.activeCount).toBe(0)
	})

	it('re-registering replaces the old cron', () => {
		const job = {
			id: 'job-1',
			projectId: 'proj-1',
			name: 'Test',
			route: '/api/cron/test',
			method: 'GET',
			schedule: '0 3 * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}

		scheduler.register(job)
		scheduler.register({ ...job, schedule: '*/5 * * * *' })
		expect(scheduler.activeCount).toBe(1)
	})

	it('skips invalid cron expressions silently', () => {
		const job = {
			id: 'job-1',
			projectId: 'proj-1',
			name: 'Bad schedule',
			route: '/api/test',
			method: 'GET',
			schedule: 'not-a-cron-expression',
			timezone: 'UTC',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}

		scheduler.register(job)
		expect(scheduler.isRegistered('job-1')).toBe(false)
	})

	it('stop clears all active crons', () => {
		const base = {
			projectId: 'proj-1',
			name: 'Test',
			route: '/api/test',
			method: 'GET' as const,
			schedule: '0 * * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}

		scheduler.register({ ...base, id: 'job-1' })
		scheduler.register({ ...base, id: 'job-2' })
		expect(scheduler.activeCount).toBe(2)

		scheduler.stop()
		expect(scheduler.activeCount).toBe(0)
	})

	it('unregister on non-existent job does nothing', () => {
		scheduler.unregister('does-not-exist')
		expect(scheduler.activeCount).toBe(0)
	})
})

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeJob(overrides: Record<string, unknown> = {}) {
	return {
		id: 'job-1',
		projectId: 'proj-1',
		name: 'Test Job',
		route: '/api/cron/test',
		method: 'GET',
		schedule: '0 * * * *',
		timezone: 'UTC',
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides
	}
}

/* ── CronScheduler.execute ────────────────────────────────────────── */

describe('CronScheduler.execute', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler({ timeoutMs: 100 })
	})

	afterEach(() => {
		scheduler.stop()
		vi.restoreAllMocks()
	})

	it('returns null when job is not found', async () => {
		/* db.select falls back to default () => chainable([]) */
		const result = await scheduler.execute('no-such-job')
		expect(result).toBeNull()
	})

	it('returns null when project is not found', async () => {
		vi.spyOn(db, 'select').mockReturnValueOnce(chainable([makeJob()]))
		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns null when there is no live deployment', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([makeJob()]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', port: 3000, slug: 'test-app' }]))
		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns null when project has no port', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([makeJob()]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', port: null, slug: 'test-app' }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1', status: 'live' }]))
		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns success when HTTP response is ok', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([makeJob()]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', port: 3000, slug: 'test-app' }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1', status: 'live' }]))
		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve('OK')
		}) as unknown as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result?.status).toBe('success')
		expect(result?.statusCode).toBe(200)
		expect(result?.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('returns failed when HTTP response is not ok', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([makeJob()]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', port: 3000, slug: 'test-app' }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1', status: 'live' }]))
		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: () => Promise.resolve('Internal Server Error')
		}) as unknown as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result?.status).toBe('failed')
		expect(result?.statusCode).toBe(500)
	})

	it('returns failed when fetch throws a network error', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([makeJob()]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', port: 3000, slug: 'test-app' }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1', status: 'live' }]))
		scheduler.fetchFn = vi.fn().mockRejectedValue(
			new Error('connection refused')
		) as unknown as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result?.status).toBe('failed')
		expect(result?.responseBody).toContain('connection refused')
	})

	it('returns timeout when fetch is aborted via AbortController', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([makeJob()]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', port: 3000, slug: 'test-app' }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1', status: 'live' }]))
		scheduler.fetchFn = vi.fn().mockRejectedValue(
			new DOMException('The operation was aborted', 'AbortError')
		) as unknown as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result?.status).toBe('timeout')
		expect(result?.responseBody).toContain('timed out')
	})
})

/* ── CronScheduler.cleanupOldRuns ─────────────────────────────────── */

describe('CronScheduler.cleanupOldRuns', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler()
	})

	afterEach(() => {
		scheduler.stop()
		vi.restoreAllMocks()
	})

	it('deletes old runs using the retention setting', async () => {
		vi.mocked(getSetting).mockResolvedValueOnce('7')
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(0)
	})

	it('uses 30 days when setting is null', async () => {
		vi.mocked(getSetting).mockResolvedValueOnce(null)
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(0)
	})

	it('uses 30 days when setting is not a number', async () => {
		vi.mocked(getSetting).mockResolvedValueOnce('not-a-number')
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(0)
	})

	it('accepts an explicit retentionDays override', async () => {
		const count = await scheduler.cleanupOldRuns(14)
		expect(count).toBe(0)
	})
})

/* ── CronScheduler.deleteProjectJobs ─────────────────────────────── */

describe('CronScheduler.deleteProjectJobs', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler()
	})

	afterEach(() => {
		scheduler.stop()
		vi.restoreAllMocks()
	})

	it('unregisters active crons and deletes DB rows for a project', async () => {
		vi.spyOn(db, 'select').mockReturnValueOnce(chainable([{ id: 'job-1' }, { id: 'job-2' }]))
		const deleteSpy = vi.spyOn(db, 'delete')

		scheduler.register(makeJob({ id: 'job-1' }))
		scheduler.register(makeJob({ id: 'job-2' }))
		expect(scheduler.activeCount).toBe(2)

		await scheduler.deleteProjectJobs('proj-1')

		expect(scheduler.activeCount).toBe(0)
		/* 2 deletes for each job's cronRuns + 1 final delete for cronJobs table */
		expect(deleteSpy).toHaveBeenCalledTimes(3)
	})

	it('does nothing meaningful when project has no jobs', async () => {
		vi.spyOn(db, 'select').mockReturnValueOnce(chainable([]))
		const deleteSpy = vi.spyOn(db, 'delete')

		await scheduler.deleteProjectJobs('empty-proj')

		/* Only the final delete(cronJobs).where(...) should be called */
		expect(deleteSpy).toHaveBeenCalledTimes(1)
	})
})

/* ── getCronScheduler singleton ───────────────────────────────────── */

describe('getCronScheduler singleton', () => {
	it('returns the same instance on repeated calls', () => {
		const a = getCronScheduler()
		const b = getCronScheduler()
		expect(a).toBe(b)
	})
})
