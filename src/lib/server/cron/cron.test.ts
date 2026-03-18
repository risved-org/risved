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

import { CronScheduler } from './index'

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
