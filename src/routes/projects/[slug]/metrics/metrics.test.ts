import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetProjectMetrics } = vi.hoisted(() => ({
	mockGetProjectMetrics: vi.fn().mockResolvedValue([])
}))

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const orderByMock = vi.fn(() => ({ limit: limitMock }))
	const directLimitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: directLimitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return {
		db: {
			select: selectMock,
			__limitMock: directLimitMock,
			__orderByLimitMock: limitMock,
			__orderByMock: orderByMock,
			__whereMock: whereMock
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
	error: vi.fn((status: number, message: string) => {
		throw Object.assign(new Error(message), { status })
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeLoadEvent(slug = 'test-app', hours?: string) {
	const url = new URL('http://localhost/')
	if (hours) url.searchParams.set('hours', hours)
	return { params: { slug }, url } as unknown as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.clearAllMocks()
	dbAny.__limitMock.mockResolvedValue([])
	dbAny.__orderByLimitMock.mockResolvedValue([])
})

describe('project metrics load', () => {
	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(load(makeLoadEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('returns metrics with default 24h window', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByLimitMock.mockResolvedValueOnce([])
		mockGetProjectMetrics.mockResolvedValueOnce([{ cpu: 10 }])

		const result = await load(makeLoadEvent())
		expect(result.hours).toBe(24)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 24)
	})

	it('accepts valid hours parameter', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByLimitMock.mockResolvedValueOnce([])
		mockGetProjectMetrics.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent('test-app', '48'))
		expect(result.hours).toBe(48)
		expect(mockGetProjectMetrics).toHaveBeenCalledWith('proj-1', 48)
	})

	it('falls back to 24h for invalid hours parameter', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByLimitMock.mockResolvedValueOnce([])
		mockGetProjectMetrics.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent('test-app', '99'))
		expect(result.hours).toBe(24)
	})

	it('returns mapped health events', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByLimitMock.mockResolvedValueOnce([
			{ id: 'he-1', event: 'unhealthy', message: 'container down', createdAt: '2026-01-01' }
		])
		mockGetProjectMetrics.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent())
		expect(result.healthEvents).toHaveLength(1)
		expect(result.healthEvents[0]).toMatchObject({ id: 'he-1', event: 'unhealthy' })
	})
})
