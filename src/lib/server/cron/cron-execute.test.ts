import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Mocks ───────────────────────────────────────────────────────────────── */

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('$lib/server/db', () => ({
	db: {
		select: (...args: unknown[]) => mockSelect(...args),
		insert: (...args: unknown[]) => mockInsert(...args),
		update: (...args: unknown[]) => mockUpdate(...args),
		delete: (...args: unknown[]) => mockDelete(...args)
	}
}))

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))

vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' },
	projects: { id: 'id' },
	deployments: { projectId: 'project_id', status: 'status' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	lt: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))

import { getSetting } from '$lib/server/settings'
import { CronScheduler, getCronScheduler } from './index'

const mockGetSetting = getSetting as ReturnType<typeof vi.fn>

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function chain(result: unknown) {
	const c: Record<string, unknown> = {}
	c.from = vi.fn().mockReturnValue(c)
	c.where = vi.fn().mockReturnValue(c)
	c.set = vi.fn().mockReturnValue(c)
	c.values = vi.fn().mockReturnValue(c)
	c.limit = vi.fn().mockResolvedValue(result)
	c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
	return c
}

const JOB = {
	id: 'job-1',
	projectId: 'proj-1',
	name: 'Test',
	route: '/cron/run',
	method: 'POST',
	schedule: '0 * * * *',
	timezone: 'UTC',
	enabled: true,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
}

const PROJECT = {
	id: 'proj-1',
	slug: 'my-app',
	port: 3000
}

const DEPLOYMENT = {
	id: 'dep-1',
	projectId: 'proj-1',
	status: 'live'
}

/* ── Tests: execute() ────────────────────────────────────────────────────── */

describe('CronScheduler.execute()', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler({ timeoutMs: 5000 })
	})

	afterEach(() => scheduler.stop())

	it('returns null when job is not found', async () => {
		mockSelect.mockReturnValue(chain([]))
		const result = await scheduler.execute('missing-job')
		expect(result).toBeNull()
	})

	it('returns null when project is not found', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValue(chain([]))
		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns null when no live deployment', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([PROJECT]))
			.mockReturnValue(chain([]))
		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns null when project has no port', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([{ ...PROJECT, port: null }]))
			.mockReturnValueOnce(chain([DEPLOYMENT]))
		const result = await scheduler.execute('job-1')
		expect(result).toBeNull()
	})

	it('returns success result on 200 response', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([PROJECT]))
			.mockReturnValueOnce(chain([DEPLOYMENT]))
		mockInsert.mockReturnValue(chain([]))
		mockUpdate.mockReturnValue(chain([]))

		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => 'OK'
		}) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result).not.toBeNull()
		expect(result!.status).toBe('success')
		expect(result!.statusCode).toBe(200)
		expect(result!.responseBody).toBe('OK')
	})

	it('returns failed result on non-2xx response', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([PROJECT]))
			.mockReturnValueOnce(chain([DEPLOYMENT]))
		mockInsert.mockReturnValue(chain([]))
		mockUpdate.mockReturnValue(chain([]))

		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => 'Internal Server Error'
		}) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result!.status).toBe('failed')
		expect(result!.statusCode).toBe(500)
	})

	it('returns timeout result on AbortError', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([PROJECT]))
			.mockReturnValueOnce(chain([DEPLOYMENT]))
		mockInsert.mockReturnValue(chain([]))
		mockUpdate.mockReturnValue(chain([]))

		const abortErr = new DOMException('Aborted', 'AbortError')
		scheduler.fetchFn = vi.fn().mockRejectedValue(abortErr) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result!.status).toBe('timeout')
		expect(result!.statusCode).toBeNull()
		expect(result!.responseBody).toContain('timed out')
	})

	it('returns failed result on generic fetch error', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([PROJECT]))
			.mockReturnValueOnce(chain([DEPLOYMENT]))
		mockInsert.mockReturnValue(chain([]))
		mockUpdate.mockReturnValue(chain([]))

		scheduler.fetchFn = vi.fn().mockRejectedValue(new Error('Network failure')) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result!.status).toBe('failed')
		expect(result!.responseBody).toContain('Network failure')
	})

	it('truncates long response bodies to 10240 chars', async () => {
		mockSelect
			.mockReturnValueOnce(chain([JOB]))
			.mockReturnValueOnce(chain([PROJECT]))
			.mockReturnValueOnce(chain([DEPLOYMENT]))
		mockInsert.mockReturnValue(chain([]))
		mockUpdate.mockReturnValue(chain([]))

		const longBody = 'x'.repeat(20000)
		scheduler.fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => longBody
		}) as typeof fetch

		const result = await scheduler.execute('job-1')
		expect(result!.responseBody!.length).toBe(10240)
	})
})

/* ── Tests: cleanupOldRuns() ─────────────────────────────────────────────── */

describe('CronScheduler.cleanupOldRuns()', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		mockGetSetting.mockResolvedValue(null)
		mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 5 }) })
		scheduler = new CronScheduler()
	})

	afterEach(() => scheduler.stop())

	it('deletes runs older than retention period', async () => {
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(5)
		expect(mockDelete).toHaveBeenCalledTimes(1)
	})

	it('uses explicit retentionDays argument when provided', async () => {
		mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 3 }) })
		const count = await scheduler.cleanupOldRuns(7)
		expect(count).toBe(3)
	})

	it('uses setting value for retention days', async () => {
		mockGetSetting.mockResolvedValue('14')
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(5)
	})

	it('falls back to 30 days when setting is invalid', async () => {
		mockGetSetting.mockResolvedValue('not-a-number')
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(5)
	})

	it('falls back to 30 days when setting is zero', async () => {
		mockGetSetting.mockResolvedValue('0')
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(5)
	})

	it('returns 0 when rowsAffected is undefined', async () => {
		mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue({}) })
		const count = await scheduler.cleanupOldRuns()
		expect(count).toBe(0)
	})
})

/* ── Tests: deleteProjectJobs() ──────────────────────────────────────────── */

describe('CronScheduler.deleteProjectJobs()', () => {
	let scheduler: CronScheduler

	beforeEach(() => {
		vi.clearAllMocks()
		scheduler = new CronScheduler()
	})

	afterEach(() => scheduler.stop())

	it('does nothing when project has no cron jobs', async () => {
		mockSelect.mockReturnValue(chain([]))
		mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue({}) })
		await scheduler.deleteProjectJobs('proj-empty')
		expect(mockDelete).toHaveBeenCalledTimes(1) // only the final cronJobs delete
	})

	it('unregisters and deletes runs for each job', async () => {
		const job1 = { id: 'job-a' }
		const job2 = { id: 'job-b' }
		mockSelect.mockReturnValue(chain([job1, job2]))
		const mockWhere = vi.fn().mockResolvedValue({})
		mockDelete.mockReturnValue({ where: mockWhere })

		// Register the jobs so unregister actually removes them
		const fullJob = { ...JOB, id: 'job-a' }
		scheduler.register(fullJob)
		scheduler.register({ ...fullJob, id: 'job-b' })
		expect(scheduler.activeCount).toBe(2)

		await scheduler.deleteProjectJobs('proj-1')

		// 2 cronRuns deletes + 1 cronJobs delete
		expect(mockDelete).toHaveBeenCalledTimes(3)
		expect(scheduler.activeCount).toBe(0)
	})
})

/* ── Tests: getCronScheduler() singleton ─────────────────────────────────── */

describe('getCronScheduler()', () => {
	it('returns the same instance on repeated calls', () => {
		const a = getCronScheduler()
		const b = getCronScheduler()
		expect(a).toBe(b)
		a.stop()
	})
})
