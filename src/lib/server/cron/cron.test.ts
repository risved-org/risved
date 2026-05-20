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

type MockDb = {
	select: ReturnType<typeof vi.fn>
	insert: ReturnType<typeof vi.fn>
	update: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
}
const mockDb = db as unknown as MockDb
const mockGetSetting = getSetting as ReturnType<typeof vi.fn>

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

/* ── CronScheduler.execute ────────────────────────────────────────── */

describe('CronScheduler.execute', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler({ timeoutMs: 1000 })
	})

	afterEach(() => scheduler.stop())

	it('returns null when job is not found', async () => {
		vi.spyOn(mockDb, 'select').mockReturnValue(
			chainable([]) as unknown as ReturnType<MockDb['select']>
		)
		const result = await scheduler.execute('nonexistent')
		expect(result).toBeNull()
	})

	it('returns null when project is not found', async () => {
		const job = {
			id: 'j1',
			projectId: 'p1',
			route: '/ping',
			method: 'GET',
			schedule: '* * * * *',
			timezone: 'UTC',
			enabled: true,
			name: 'Ping'
		}
		vi.spyOn(mockDb, 'select')
			.mockReturnValueOnce(chainable([job]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValue(chainable([]) as unknown as ReturnType<MockDb['select']>)
		const result = await scheduler.execute('j1')
		expect(result).toBeNull()
	})

	it('returns null when no live deployment exists', async () => {
		const job = { id: 'j1', projectId: 'p1', route: '/ping', method: 'GET', schedule: '* * * * *', timezone: 'UTC', enabled: true, name: 'Ping' }
		const project = { id: 'p1', slug: 'my-app', port: 3000 }
		vi.spyOn(mockDb, 'select')
			.mockReturnValueOnce(chainable([job]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValueOnce(chainable([project]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValue(chainable([]) as unknown as ReturnType<MockDb['select']>)
		const result = await scheduler.execute('j1')
		expect(result).toBeNull()
	})

	it('returns null when project has no port', async () => {
		const job = { id: 'j1', projectId: 'p1', route: '/ping', method: 'GET', schedule: '* * * * *', timezone: 'UTC', enabled: true, name: 'Ping' }
		const project = { id: 'p1', slug: 'my-app', port: null }
		const deployment = { id: 'd1', projectId: 'p1', status: 'live' }
		vi.spyOn(mockDb, 'select')
			.mockReturnValueOnce(chainable([job]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValueOnce(chainable([project]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValue(chainable([deployment]) as unknown as ReturnType<MockDb['select']>)
		const result = await scheduler.execute('j1')
		expect(result).toBeNull()
	})

	it('records success when fetch returns 2xx', async () => {
		const job = { id: 'j1', projectId: 'p1', route: '/ping', method: 'GET', schedule: '* * * * *', timezone: 'UTC', enabled: true, name: 'Ping' }
		const project = { id: 'p1', slug: 'my-app', port: 3000 }
		const deployment = { id: 'd1', projectId: 'p1', status: 'live' }

		vi.spyOn(mockDb, 'select')
			.mockReturnValueOnce(chainable([job]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValueOnce(chainable([project]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValue(chainable([deployment]) as unknown as ReturnType<MockDb['select']>)

		const insertValues = vi.fn().mockResolvedValue([])
		vi.spyOn(mockDb, 'insert').mockReturnValue(
			{ values: insertValues } as unknown as ReturnType<MockDb['insert']>
		)

		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
		vi.spyOn(mockDb, 'update').mockReturnValue(
			{ set: updateSet } as unknown as ReturnType<MockDb['update']>
		)

		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue('OK')
		})

		const result = await scheduler.execute('j1')
		expect(result?.status).toBe('success')
		expect(result?.statusCode).toBe(200)
	})

	it('records failed status when fetch returns non-2xx', async () => {
		const job = { id: 'j1', projectId: 'p1', route: '/ping', method: 'GET', schedule: '* * * * *', timezone: 'UTC', enabled: true, name: 'Ping' }
		const project = { id: 'p1', slug: 'my-app', port: 3000 }
		const deployment = { id: 'd1', projectId: 'p1', status: 'live' }

		vi.spyOn(mockDb, 'select')
			.mockReturnValueOnce(chainable([job]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValueOnce(chainable([project]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValue(chainable([deployment]) as unknown as ReturnType<MockDb['select']>)

		const insertValues = vi.fn().mockResolvedValue([])
		vi.spyOn(mockDb, 'insert').mockReturnValue({ values: insertValues } as unknown as ReturnType<MockDb['insert']>)
		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
		vi.spyOn(mockDb, 'update').mockReturnValue({ set: updateSet } as unknown as ReturnType<MockDb['update']>)

		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: vi.fn().mockResolvedValue('error')
		})

		const result = await scheduler.execute('j1')
		expect(result?.status).toBe('failed')
		expect(result?.statusCode).toBe(500)
	})

	it('records timeout status when fetch aborts', async () => {
		const job = { id: 'j1', projectId: 'p1', route: '/ping', method: 'GET', schedule: '* * * * *', timezone: 'UTC', enabled: true, name: 'Ping' }
		const project = { id: 'p1', slug: 'my-app', port: 3000 }
		const deployment = { id: 'd1', projectId: 'p1', status: 'live' }

		vi.spyOn(mockDb, 'select')
			.mockReturnValueOnce(chainable([job]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValueOnce(chainable([project]) as unknown as ReturnType<MockDb['select']>)
			.mockReturnValue(chainable([deployment]) as unknown as ReturnType<MockDb['select']>)

		const insertValues = vi.fn().mockResolvedValue([])
		vi.spyOn(mockDb, 'insert').mockReturnValue({ values: insertValues } as unknown as ReturnType<MockDb['insert']>)
		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
		vi.spyOn(mockDb, 'update').mockReturnValue({ set: updateSet } as unknown as ReturnType<MockDb['update']>)

		const abortErr = new DOMException('Aborted', 'AbortError')
		scheduler.fetchFn = vi.fn().mockRejectedValue(abortErr)

		const result = await scheduler.execute('j1')
		expect(result?.status).toBe('timeout')
	})
})

/* ── CronScheduler.cleanupOldRuns ─────────────────────────────────── */

describe('CronScheduler.cleanupOldRuns', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler()
	})

	afterEach(() => scheduler.stop())

	it('returns count from db.delete', async () => {
		mockGetSetting.mockResolvedValue(null)
		const deletedWhere = vi.fn().mockResolvedValue({ rowsAffected: 5 })
		vi.spyOn(mockDb, 'delete').mockReturnValue({ where: deletedWhere } as unknown as ReturnType<MockDb['delete']>)

		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(5)
	})

	it('uses retention from settings when provided', async () => {
		mockGetSetting.mockResolvedValue('14')
		vi.spyOn(mockDb, 'delete').mockReturnValue({
			where: vi.fn().mockResolvedValue({ rowsAffected: 3 })
		} as unknown as ReturnType<MockDb['delete']>)

		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(3)
	})

	it('overrides retention when explicit argument is provided', async () => {
		mockGetSetting.mockResolvedValue(null)
		vi.spyOn(mockDb, 'delete').mockReturnValue({
			where: vi.fn().mockResolvedValue({ rowsAffected: 2 })
		} as unknown as ReturnType<MockDb['delete']>)

		const count = await scheduler.cleanupOldRuns(7)
		expect(count).toBe(2)
	})
})

/* ── CronScheduler.deleteProjectJobs ─────────────────────────────── */

describe('CronScheduler.deleteProjectJobs', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler()
	})

	afterEach(() => scheduler.stop())

	it('deletes nothing when project has no jobs', async () => {
		vi.spyOn(mockDb, 'select').mockReturnValue(
			chainable([]) as unknown as ReturnType<MockDb['select']>
		)
		const deletedWhere = vi.fn().mockResolvedValue({ rowsAffected: 0 })
		vi.spyOn(mockDb, 'delete').mockReturnValue({ where: deletedWhere } as unknown as ReturnType<MockDb['delete']>)

		await scheduler.deleteProjectJobs('p-no-jobs')
		expect(deletedWhere).toHaveBeenCalledTimes(1) // just the cronJobs table delete
	})

	it('unregisters and deletes runs for existing jobs', async () => {
		const jobs = [{ id: 'j1' }, { id: 'j2' }]
		vi.spyOn(mockDb, 'select').mockReturnValue(
			chainable(jobs) as unknown as ReturnType<MockDb['select']>
		)
		const deletedWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
		vi.spyOn(mockDb, 'delete').mockReturnValue({ where: deletedWhere } as unknown as ReturnType<MockDb['delete']>)

		// Register j1 so we can verify it gets unregistered
		scheduler.register({ id: 'j1', projectId: 'p1', name: 'J1', route: '/ping', method: 'GET', schedule: '0 3 * * *', timezone: 'UTC', enabled: true, createdAt: '', updatedAt: '' })
		expect(scheduler.isRegistered('j1')).toBe(true)

		await scheduler.deleteProjectJobs('p1')
		expect(scheduler.isRegistered('j1')).toBe(false)
	})
})

/* ── getCronScheduler singleton ───────────────────────────────────── */

describe('getCronScheduler', () => {
	it('returns the same instance on repeated calls', () => {
		const a = getCronScheduler()
		const b = getCronScheduler()
		expect(a).toBe(b)
	})
})
