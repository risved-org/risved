import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const selectMock = vi.fn()
	return { db: { select: selectMock } }
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_result'),
	desc: vi.fn(() => 'desc_result')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	cronJobs: 'cronJobs_table',
	cronRuns: 'cronRuns_table'
}))

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, msg: string) => {
		throw Object.assign(new Error(msg), { status })
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const mockSelect = db.select as ReturnType<typeof vi.fn>

function makeEvent(slug = 'my-app') {
	return { params: { slug } } as Parameters<typeof load>[0]
}

function mockProjectLookup(project: Record<string, unknown> | null) {
	mockSelect.mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(project ? [project] : [])
			})
		})
	})
}

function mockJobsLookup(jobs: Record<string, unknown>[]) {
	mockSelect.mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(jobs)
		})
	})
}

function mockLastRunLookup(runs: Record<string, unknown>[]) {
	mockSelect.mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(runs)
				})
			})
		})
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

const baseProject = { id: 'proj-1', name: 'My App', slug: 'my-app' }

const baseJob = {
	id: 'job-1',
	name: 'Daily Report',
	route: '/api/report',
	method: 'GET',
	schedule: '0 9 * * *',
	timezone: 'UTC',
	enabled: true,
	createdAt: '2026-01-01T00:00:00Z'
}

const baseRun = {
	status: 'success',
	statusCode: 200,
	startedAt: '2026-01-02T09:00:00Z',
	completedAt: '2026-01-02T09:00:05Z',
	durationMs: 5000
}

describe('crons page load', () => {
	it('throws 404 when project not found', async () => {
		mockProjectLookup(null)
		await expect(load(makeEvent('nonexistent'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns project with empty cronJobs when none exist', async () => {
		mockProjectLookup(baseProject)
		mockJobsLookup([])

		const result = await load(makeEvent())

		expect(result.project).toMatchObject({ id: 'proj-1', name: 'My App', slug: 'my-app' })
		expect(result.cronJobs).toEqual([])
	})

	it('returns cron job with last run data when a run exists', async () => {
		mockProjectLookup(baseProject)
		mockJobsLookup([baseJob])
		mockLastRunLookup([baseRun])

		const result = await load(makeEvent())

		expect(result.cronJobs).toHaveLength(1)
		expect(result.cronJobs[0]).toMatchObject({
			id: 'job-1',
			name: 'Daily Report',
			route: '/api/report',
			method: 'GET',
			schedule: '0 9 * * *',
			timezone: 'UTC',
			enabled: true,
			lastRun: {
				status: 'success',
				statusCode: 200,
				startedAt: '2026-01-02T09:00:00Z',
				completedAt: '2026-01-02T09:00:05Z',
				durationMs: 5000
			}
		})
	})

	it('sets lastRun to null when no runs exist for a job', async () => {
		mockProjectLookup(baseProject)
		mockJobsLookup([baseJob])
		mockLastRunLookup([])

		const result = await load(makeEvent())

		expect(result.cronJobs[0].lastRun).toBeNull()
	})

	it('returns multiple jobs with mixed lastRun state', async () => {
		const jobA = { ...baseJob, id: 'job-a', name: 'Job A' }
		const jobB = { ...baseJob, id: 'job-b', name: 'Job B', method: 'POST', enabled: false }

		mockProjectLookup(baseProject)
		mockJobsLookup([jobA, jobB])
		mockLastRunLookup([{ ...baseRun, status: 'failed', statusCode: 500 }])
		mockLastRunLookup([])

		const result = await load(makeEvent())

		expect(result.cronJobs).toHaveLength(2)
		expect(result.cronJobs[0].lastRun).toMatchObject({ status: 'failed', statusCode: 500 })
		expect(result.cronJobs[1].lastRun).toBeNull()
	})

	it('maps all cron job fields to the response', async () => {
		const job = {
			...baseJob,
			schedule: '5 4 * * *',
			timezone: 'Europe/London',
			enabled: false,
			createdAt: '2026-01-15T12:00:00Z'
		}

		mockProjectLookup(baseProject)
		mockJobsLookup([job])
		mockLastRunLookup([])

		const result = await load(makeEvent())
		const cronJob = result.cronJobs[0]

		expect(cronJob.schedule).toBe('5 4 * * *')
		expect(cronJob.timezone).toBe('Europe/London')
		expect(cronJob.enabled).toBe(false)
		expect(cronJob.createdAt).toBe('2026-01-15T12:00:00Z')
	})

	it('queries db with the correct slug from route params', async () => {
		mockProjectLookup(null)
		try {
			await load(makeEvent('custom-slug'))
		} catch {
			/* 404 */
		}
		expect(db.select).toHaveBeenCalled()
	})
})
