import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const orderByMock = vi.fn().mockResolvedValue([])
	const limitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock, orderBy: orderByMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return {
		db: {
			select: selectMock,
			__limitMock: limitMock,
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
	deployments: 'deployments_table'
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
	return { params: { slug } } as unknown as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.clearAllMocks()
	dbAny.__limitMock.mockResolvedValue([])
	dbAny.__orderByMock.mockResolvedValue([])
})

describe('project deployments load', () => {
	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(load(makeLoadEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('returns empty deployments when none exist', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByMock.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent())
		expect(result.deployments).toEqual([])
	})

	it('returns deployments with mapped fields', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByMock.mockResolvedValueOnce([
			{
				id: 'dep-1',
				commitSha: 'abc1234',
				status: 'live',
				triggerType: 'push',
				imageTag: 'proj-1:abc1234',
				createdAt: '2026-01-01T00:00:00Z',
				finishedAt: '2026-01-01T00:01:00Z'
			},
			{
				id: 'dep-2',
				commitSha: 'def5678',
				status: 'failed',
				triggerType: 'manual',
				imageTag: 'proj-1:def5678',
				createdAt: '2026-01-02T00:00:00Z',
				finishedAt: null
			}
		])

		const result = await load(makeLoadEvent())
		expect(result.deployments).toHaveLength(2)
		expect(result.deployments[0]).toMatchObject({
			id: 'dep-1',
			commitSha: 'abc1234',
			status: 'live'
		})
	})

	it('deduplicates deployments by id', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])
		dbAny.__orderByMock.mockResolvedValueOnce([
			{ id: 'dep-1', commitSha: 'abc', status: 'live', triggerType: 'push', imageTag: null, createdAt: '2026-01-01', finishedAt: null },
			{ id: 'dep-1', commitSha: 'abc', status: 'live', triggerType: 'push', imageTag: null, createdAt: '2026-01-01', finishedAt: null }
		])

		const result = await load(makeLoadEvent())
		expect(result.deployments).toHaveLength(1)
	})
})
