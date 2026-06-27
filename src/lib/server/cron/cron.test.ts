import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Creates a thenable chain object that resolves to `result` when awaited directly,
 * but also supports chaining .from().where().limit() etc.
 */
function chainable(result: unknown[]): never {
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
	return chain as never
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

import { CronScheduler, getCronScheduler } from './index'
import { db } from '$lib/server/db'
import { getSetting } from '$lib/server/settings'

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

describe('CronScheduler.execute', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		scheduler = new CronScheduler({ timeoutMs: 5000 })
	})

	afterEach(() => {
		scheduler.stop()
	})

	it('returns null when job is not found', async () => {
		const result = await scheduler.execute('does-not-exist')
		expect(result).toBeNull()
	})

	it('returns null when project is not found', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([{
				id: 'job-1',
				projectId: 'proj-1',
				route: '/health',
				method: 'GET'
			}]))
			.mockReturnValueOnce(chainable([]))

		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns null when no live deployment exists', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([{ id: 'job-1', projectId: 'proj-1', route: '/health', method: 'GET' }]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', slug: 'myapp', port: 3000 }]))
			.mockReturnValueOnce(chainable([]))

		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns null when project has no port', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([{ id: 'job-1', projectId: 'proj-1', route: '/health', method: 'GET' }]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', slug: 'myapp', port: null }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1' }]))

		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('executes HTTP request and records success', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([{ id: 'job-1', projectId: 'proj-1', route: '/health', method: 'GET' }]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', slug: 'myapp', port: 3000 }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1' }]))

		const insertChain = chainable([])
		vi.spyOn(db, 'insert').mockReturnValue(insertChain as never)
		const updateChain = chainable([])
		vi.spyOn(db, 'update').mockReturnValue(updateChain as never)

		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve('OK')
		}) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result).not.toBeNull()
		expect(result?.status).toBe('success')
		expect(result?.statusCode).toBe(200)
	})

	it('records failed status on non-2xx response', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([{ id: 'job-1', projectId: 'proj-1', route: '/fail', method: 'POST' }]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', slug: 'myapp', port: 3000 }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1' }]))

		vi.spyOn(db, 'insert').mockReturnValue(chainable([]) as never)
		vi.spyOn(db, 'update').mockReturnValue(chainable([]) as never)

		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: () => Promise.resolve('Server Error')
		}) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result?.status).toBe('failed')
		expect(result?.statusCode).toBe(500)
	})

	it('records timeout status on AbortError', async () => {
		vi.spyOn(db, 'select')
			.mockReturnValueOnce(chainable([{ id: 'job-1', projectId: 'proj-1', route: '/slow', method: 'GET' }]))
			.mockReturnValueOnce(chainable([{ id: 'proj-1', slug: 'myapp', port: 3000 }]))
			.mockReturnValueOnce(chainable([{ id: 'dep-1' }]))

		vi.spyOn(db, 'insert').mockReturnValue(chainable([]) as never)
		vi.spyOn(db, 'update').mockReturnValue(chainable([]) as never)

		scheduler.fetchFn = vi.fn().mockRejectedValue(
			Object.assign(new DOMException('aborted', 'AbortError'))
		) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result?.status).toBe('timeout')
	})
})

describe('CronScheduler.cleanupOldRuns', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		scheduler = new CronScheduler()
	})

	it('uses log_retention_days setting when available', async () => {
		vi.mocked(getSetting).mockResolvedValue('14')
		vi.spyOn(db, 'delete').mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 3 }) } as never)

		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(3)
	})

	it('uses provided retentionDays argument', async () => {
		vi.spyOn(db, 'delete').mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) } as never)

		const count = await scheduler.cleanupOldRuns(7)
		expect(count).toBe(1)
	})

	it('defaults to 30 days when setting is null', async () => {
		vi.mocked(getSetting).mockResolvedValue(null)
		vi.spyOn(db, 'delete').mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) } as never)

		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(0)
	})
})

describe('CronScheduler.deleteProjectJobs', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		scheduler = new CronScheduler()
	})

	it('unregisters jobs and deletes DB records', async () => {
		vi.spyOn(db, 'select').mockReturnValue(chainable([{ id: 'job-1' }, { id: 'job-2' }]))
		const deleteFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		vi.spyOn(db, 'delete').mockImplementation(deleteFn as never)

		scheduler.register({
			id: 'job-1',
			projectId: 'proj-1',
			name: 'J1',
			route: '/r',
			method: 'GET',
			schedule: '0 * * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		})
		expect(scheduler.isRegistered('job-1')).toBe(true)

		await scheduler.deleteProjectJobs('proj-1')

		expect(scheduler.isRegistered('job-1')).toBe(false)
		expect(deleteFn).toHaveBeenCalledTimes(3)
	})
})

describe('getCronScheduler singleton', () => {
	it('returns the same instance on repeated calls', () => {
		const a = getCronScheduler()
		const b = getCronScheduler()
		expect(a).toBe(b)
		a.stop()
	})
})
