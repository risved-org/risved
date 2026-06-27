import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const mockDb = { select: vi.fn() }
	return { db: mockDb }
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	desc: vi.fn(() => 'desc_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	cronJobs: 'cronJobs_table',
	cronRuns: 'cronRuns_table'
}))

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, message: string) => {
		throw Object.assign(new Error(message), { status })
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeLoadEvent(slug = 'test-app') {
	return { params: { slug } } as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('crons page load', () => {
	it('throws 404 when project not found', async () => {
		dbAny.select.mockImplementationOnce(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		}))

		await expect(load(makeLoadEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('returns project and empty cronJobs when no jobs exist', async () => {
		dbAny.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1', name: 'My App', slug: 'test-app' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([])
				})
			}))

		const result = await load(makeLoadEvent())
		expect(result.cronJobs).toEqual([])
		expect(result.project).toMatchObject({ id: 'p-1', name: 'My App', slug: 'test-app' })
	})

	it('returns cronJob with lastRun populated when a run exists', async () => {
		const job = {
			id: 'cj-1',
			name: 'Cleanup',
			route: '/api/cleanup',
			method: 'POST',
			schedule: '0 0 * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: '2026-01-01T00:00:00Z'
		}
		const lastRun = {
			status: 'success',
			statusCode: 200,
			startedAt: '2026-06-25T00:00:00Z',
			completedAt: '2026-06-25T00:00:01Z',
			durationMs: 1000
		}

		dbAny.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1', name: 'My App', slug: 'test-app' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([job])
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([lastRun])
						})
					})
				})
			}))

		const result = await load(makeLoadEvent())
		expect(result.cronJobs).toHaveLength(1)
		expect(result.cronJobs[0]).toMatchObject({
			id: 'cj-1',
			name: 'Cleanup',
			lastRun: { status: 'success', statusCode: 200 }
		})
	})

	it('returns cronJob with lastRun null when no run exists', async () => {
		const job = {
			id: 'cj-1',
			name: 'Cleanup',
			route: '/api/cleanup',
			method: 'POST',
			schedule: '0 0 * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: '2026-01-01T00:00:00Z'
		}

		dbAny.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1', name: 'My App', slug: 'test-app' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([job])
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([])
						})
					})
				})
			}))

		const result = await load(makeLoadEvent())
		expect(result.cronJobs).toHaveLength(1)
		expect(result.cronJobs[0].lastRun).toBeNull()
	})

	it('handles multiple cronJobs with mixed last run states', async () => {
		const jobs = [
			{
				id: 'cj-1',
				name: 'Job 1',
				route: '/api/job1',
				method: 'GET',
				schedule: '0 * * * *',
				timezone: 'UTC',
				enabled: true,
				createdAt: '2026-01-01'
			},
			{
				id: 'cj-2',
				name: 'Job 2',
				route: '/api/job2',
				method: 'POST',
				schedule: '0 0 * * *',
				timezone: 'UTC',
				enabled: false,
				createdAt: '2026-01-02'
			}
		]

		dbAny.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1', name: 'My App', slug: 'test-app' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue(jobs)
				})
			}))
			// job 1 has a last run
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([
								{
									status: 'error',
									statusCode: 500,
									startedAt: '2026-01-01',
									completedAt: '2026-01-01',
									durationMs: 100
								}
							])
						})
					})
				})
			}))
			// job 2 has no last run
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([])
						})
					})
				})
			}))

		const result = await load(makeLoadEvent())
		expect(result.cronJobs).toHaveLength(2)
		expect(result.cronJobs[0].lastRun).not.toBeNull()
		expect(result.cronJobs[0].lastRun?.status).toBe('error')
		expect(result.cronJobs[1].lastRun).toBeNull()
	})

	it('maps all job fields correctly', async () => {
		const job = {
			id: 'cj-99',
			name: 'Full Job',
			route: '/api/full',
			method: 'DELETE',
			schedule: '*/5 * * * *',
			timezone: 'America/New_York',
			enabled: false,
			createdAt: '2026-06-01T12:00:00Z'
		}

		dbAny.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-99', name: 'Full App', slug: 'full-app' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([job])
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([])
						})
					})
				})
			}))

		const result = await load({ params: { slug: 'full-app' } } as Parameters<typeof load>[0])
		const mapped = result.cronJobs[0]
		expect(mapped.id).toBe('cj-99')
		expect(mapped.route).toBe('/api/full')
		expect(mapped.method).toBe('DELETE')
		expect(mapped.schedule).toBe('*/5 * * * *')
		expect(mapped.timezone).toBe('America/New_York')
		expect(mapped.enabled).toBe(false)
		expect(mapped.createdAt).toBe('2026-06-01T12:00:00Z')
	})
})
