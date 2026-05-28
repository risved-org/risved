import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockDb, mockGetSetting } = vi.hoisted(() => ({
	mockDb: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	},
	mockGetSetting: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' },
	projects: { id: 'id' },
	deployments: { projectId: 'project_id', status: 'status' }
}))

/**
 * Creates a thenable chain that resolves to `result` when awaited,
 * and supports chaining .from().where().limit() etc.
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

function resetDbDefaults() {
	mockDb.select.mockImplementation(() => chainable([]))
	mockDb.insert.mockImplementation(() => chainable([]))
	mockDb.update.mockImplementation(() => chainable([]))
	mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) }))
	mockGetSetting.mockResolvedValue(null)
}

import { CronScheduler, getCronScheduler } from './index'

const BASE_JOB = {
	id: 'job-1',
	projectId: 'proj-1',
	name: 'Test',
	route: '/api/cron/test',
	method: 'GET' as const,
	schedule: '0 3 * * *',
	timezone: 'UTC',
	enabled: true,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
}

describe('CronScheduler — lifecycle', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		resetDbDefaults()
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

	it('does not start twice', async () => {
		await scheduler.start()
		await scheduler.start()
		expect(mockDb.select).toHaveBeenCalledTimes(1)
	})

	it('registers a cron job', () => {
		scheduler.register(BASE_JOB)
		expect(scheduler.isRegistered('job-1')).toBe(true)
		expect(scheduler.activeCount).toBe(1)
	})

	it('unregisters a cron job', () => {
		scheduler.register(BASE_JOB)
		scheduler.unregister('job-1')
		expect(scheduler.isRegistered('job-1')).toBe(false)
		expect(scheduler.activeCount).toBe(0)
	})

	it('re-registering replaces the old cron', () => {
		scheduler.register(BASE_JOB)
		scheduler.register({ ...BASE_JOB, schedule: '*/5 * * * *' })
		expect(scheduler.activeCount).toBe(1)
	})

	it('skips invalid cron expressions silently', () => {
		scheduler.register({ ...BASE_JOB, schedule: 'not-a-cron-expression' })
		expect(scheduler.isRegistered('job-1')).toBe(false)
	})

	it('stop clears all active crons', () => {
		scheduler.register({ ...BASE_JOB, id: 'job-1' })
		scheduler.register({ ...BASE_JOB, id: 'job-2' })
		expect(scheduler.activeCount).toBe(2)
		scheduler.stop()
		expect(scheduler.activeCount).toBe(0)
	})

	it('unregister on non-existent job does nothing', () => {
		scheduler.unregister('does-not-exist')
		expect(scheduler.activeCount).toBe(0)
	})
})

describe('CronScheduler — execute', () => {
	let scheduler: CronScheduler

	const JOB = { ...BASE_JOB, id: 'job-exec' }
	const PROJECT = { id: 'proj-1', slug: 'my-app', port: 3000 }
	const DEPLOYMENT = { id: 'dep-1', status: 'live', projectId: 'proj-1' }

	beforeEach(() => {
		vi.clearAllMocks()
		resetDbDefaults()
		scheduler = new CronScheduler({ timeoutMs: 5000 })
	})

	afterEach(() => {
		scheduler.stop()
	})

	it('returns null when job is not found', async () => {
		mockDb.select.mockImplementation(() => chainable([]))
		const result = await scheduler.execute('missing-job')
		expect(result).toBeNull()
	})

	it('returns null when project is not found', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([]))
		const result = await scheduler.execute('job-exec')
		expect(result).toBeNull()
	})

	it('returns null when no live deployment exists', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([PROJECT]))
			.mockImplementationOnce(() => chainable([]))
		const result = await scheduler.execute('job-exec')
		expect(result).toBeNull()
	})

	it('returns null when project has no port', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([{ ...PROJECT, port: null }]))
			.mockImplementationOnce(() => chainable([DEPLOYMENT]))
		const result = await scheduler.execute('job-exec')
		expect(result).toBeNull()
	})

	it('returns success result on 2xx response', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([PROJECT]))
			.mockImplementationOnce(() => chainable([DEPLOYMENT]))
		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve('pong')
		}) as typeof fetch

		const result = await scheduler.execute('job-exec')
		expect(result?.status).toBe('success')
		expect(result?.statusCode).toBe(200)
		expect(result?.responseBody).toBe('pong')
		expect(result?.durationMs).toBeGreaterThanOrEqual(0)
		expect(mockDb.insert).toHaveBeenCalled()
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('returns failed result on non-2xx response', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([PROJECT]))
			.mockImplementationOnce(() => chainable([DEPLOYMENT]))
		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: () => Promise.resolve('Internal Server Error')
		}) as typeof fetch

		const result = await scheduler.execute('job-exec')
		expect(result?.status).toBe('failed')
		expect(result?.statusCode).toBe(500)
	})

	it('returns timeout result on AbortError', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([PROJECT]))
			.mockImplementationOnce(() => chainable([DEPLOYMENT]))
		const abortError = new DOMException('aborted', 'AbortError')
		scheduler.fetchFn = vi.fn().mockRejectedValue(abortError) as typeof fetch

		const result = await scheduler.execute('job-exec')
		expect(result?.status).toBe('timeout')
		expect(result?.statusCode).toBeNull()
		expect(result?.responseBody).toContain('timed out')
	})

	it('returns failed result on network error', async () => {
		mockDb.select
			.mockImplementationOnce(() => chainable([JOB]))
			.mockImplementationOnce(() => chainable([PROJECT]))
			.mockImplementationOnce(() => chainable([DEPLOYMENT]))
		scheduler.fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch

		const result = await scheduler.execute('job-exec')
		expect(result?.status).toBe('failed')
		expect(result?.statusCode).toBeNull()
		expect(result?.responseBody).toContain('ECONNREFUSED')
	})
})

describe('CronScheduler — cleanupOldRuns', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		resetDbDefaults()
		scheduler = new CronScheduler()
	})

	it('uses retention setting from DB when no override given', async () => {
		mockGetSetting.mockResolvedValue('14')
		mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 3 }) }))
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(3)
		expect(mockGetSetting).toHaveBeenCalledWith('log_retention_days')
	})

	it('uses explicit retentionDays override ignoring the setting', async () => {
		mockGetSetting.mockResolvedValue('90')
		mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 7 }) }))
		const count = await scheduler.cleanupOldRuns(7)
		expect(count).toBe(7)
	})

	it('falls back to 30 days when setting is null', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) }))
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(0)
	})

	it('falls back to 30 when setting is NaN', async () => {
		mockGetSetting.mockResolvedValue('not-a-number')
		mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) }))
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(1)
	})

	it('returns 0 when rowsAffected is undefined', async () => {
		mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({}) }))
		const count = await scheduler.cleanupOldRuns(30)
		expect(count).toBe(0)
	})
})

describe('CronScheduler — deleteProjectJobs', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		resetDbDefaults()
		scheduler = new CronScheduler()
	})

	it('deletes runs for each job then deletes all jobs', async () => {
		const jobs = [{ id: 'job-1' }, { id: 'job-2' }]
		const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
		mockDb.select.mockImplementation(() => chainable(jobs))
		mockDb.delete.mockImplementation(() => ({ where: deleteWhere }))

		await scheduler.deleteProjectJobs('proj-1')

		expect(mockDb.delete).toHaveBeenCalledTimes(3)
	})

	it('unregisters active jobs during deletion', async () => {
		scheduler.register(BASE_JOB)
		expect(scheduler.isRegistered('job-1')).toBe(true)

		mockDb.select.mockImplementation(() => chainable([{ id: 'job-1' }]))

		await scheduler.deleteProjectJobs('proj-1')
		expect(scheduler.isRegistered('job-1')).toBe(false)
	})

	it('handles project with no jobs gracefully', async () => {
		mockDb.select.mockImplementation(() => chainable([]))
		mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) }))

		await scheduler.deleteProjectJobs('proj-empty')
		expect(mockDb.delete).toHaveBeenCalledTimes(1)
	})
})

describe('getCronScheduler', () => {
	it('returns the same singleton on repeated calls', () => {
		const a = getCronScheduler()
		const b = getCronScheduler()
		expect(a).toBe(b)
	})
})
