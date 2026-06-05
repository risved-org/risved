import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const orderByMock = vi.fn(() => ({ limit: limitMock }))
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return {
		db: {
			select: selectMock,
			__limitMock: limitMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	desc: vi.fn(() => 'desc_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	healthEvents: 'health_events_table'
}))

const mockGetProjectMetrics = vi.fn().mockResolvedValue([])

vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: vi.fn((...args: unknown[]) => mockGetProjectMetrics(...args))
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeLoadEvent(slug: string, searchParams: Record<string, string> = {}) {
	const url = new URL(`http://localhost/projects/${slug}/metrics`)
	Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v))
	return {
		params: { slug },
		url
	} as Parameters<typeof load>[0]
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('metrics page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
		mockGetProjectMetrics.mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(load(makeLoadEvent('nonexistent'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns metrics with default 24 hours', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }])

		const result = await load(makeLoadEvent('my-app'))

		expect(result.hours).toBe(24)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 24)
	})

	it('uses valid hours param when provided', async () => {
		for (const h of [6, 12, 48, 168]) {
			vi.clearAllMocks()
			dbAny.__limitMock.mockResolvedValue([])
			mockGetProjectMetrics.mockResolvedValue([])
			dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }])

			const result = await load(makeLoadEvent('my-app', { hours: String(h) }))
			expect(result.hours).toBe(h)
		}
	})

	it('defaults to 24 hours for invalid hours param', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }])

		const result = await load(makeLoadEvent('my-app', { hours: '999' }))
		expect(result.hours).toBe(24)
	})

	it('defaults to 24 hours for non-numeric hours param', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }])

		const result = await load(makeLoadEvent('my-app', { hours: 'abc' }))
		expect(result.hours).toBe(24)
	})

	it('returns mapped health events', async () => {
		const events = [
			{ id: 'ev-1', event: 'unhealthy', message: 'container down', createdAt: '2024-01-01', extra: 'x' },
			{ id: 'ev-2', event: 'healthy', message: 'recovered', createdAt: '2024-01-02', extra: 'y' }
		]
		/* First limitMock call: project; second (via orderBy chain): health events */
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1' }])
			.mockResolvedValueOnce(events)

		const result = await load(makeLoadEvent('my-app'))

		expect(result.healthEvents).toHaveLength(2)
		expect(result.healthEvents[0]).toEqual({
			id: 'ev-1',
			event: 'unhealthy',
			message: 'container down',
			createdAt: '2024-01-01'
		})
		expect(result.healthEvents[0]).not.toHaveProperty('extra')
	})

	it('returns empty healthEvents when none exist', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1' }])
			.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent('my-app'))
		expect(result.healthEvents).toEqual([])
	})

	it('returns resourceMetrics from getProjectMetrics', async () => {
		const metrics = [{ timestamp: '2024-01-01', cpuPercent: 10, memoryMb: 128 }]
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }])
		mockGetProjectMetrics.mockResolvedValueOnce(metrics)

		const result = await load(makeLoadEvent('my-app'))
		expect(result.resourceMetrics).toEqual(metrics)
	})
})
