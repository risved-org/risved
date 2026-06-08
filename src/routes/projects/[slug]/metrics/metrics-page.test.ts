import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetProjectMetrics } = vi.hoisted(() => ({
	mockGetProjectMetrics: vi.fn().mockResolvedValue([])
}))

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const orderByMock = vi.fn(() => ({ limit: limitMock }))
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return {
		db: {
			select: selectMock,
			__limitMock: limitMock,
			__orderByMock: orderByMock
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

vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: mockGetProjectMetrics
}))

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, msg: string) => {
		const err = new Error(msg) as Error & { status: number }
		err.status = status
		throw err
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeLoadEvent(slug = 'my-app', searchParams: Record<string, string> = {}) {
	const url = new URL('http://localhost/')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return { params: { slug }, url } as unknown as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.clearAllMocks()
	dbAny.__limitMock.mockResolvedValue([])
})

describe('projects/[slug]/metrics load', () => {
	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])
		await expect(load(makeLoadEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('defaults to 24h window', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]).mockResolvedValueOnce([])

		const result = await load(makeLoadEvent())
		expect(result.hours).toBe(24)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 24)
	})

	it('uses valid hours param', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]).mockResolvedValueOnce([])

		const result = await load(makeLoadEvent('my-app', { hours: '168' }))
		expect(result.hours).toBe(168)
	})

	it('falls back to 24 for invalid hours param', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]).mockResolvedValueOnce([])

		const result = await load(makeLoadEvent('my-app', { hours: '999' }))
		expect(result.hours).toBe(24)
	})

	it('returns resource metrics and health events', async () => {
		const metrics = [{ hour: '2026-01-01T00:00:00Z', cpuPct: 10, memMb: 256 }]
		const healthEvt = {
			id: 'evt-1',
			event: 'restart',
			message: 'Container restarted',
			createdAt: '2026-01-01T00:00:00Z',
			projectId: 'proj-1'
		}
		mockGetProjectMetrics.mockResolvedValueOnce(metrics)
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1' }])
			.mockResolvedValueOnce([healthEvt])

		const result = await load(makeLoadEvent())
		expect(result.resourceMetrics).toEqual(metrics)
		expect(result.healthEvents).toHaveLength(1)
		expect(result.healthEvents[0]).toMatchObject({ id: 'evt-1', event: 'restart' })
	})
})
