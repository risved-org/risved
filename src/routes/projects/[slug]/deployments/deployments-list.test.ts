import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const orderByMock = vi.fn().mockResolvedValue([])
	const limitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
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
	error: vi.fn((status: number, msg: string) => {
		const err = new Error(msg) as Error & { status: number }
		err.status = status
		throw err
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeLoadEvent(slug = 'my-app') {
	return { params: { slug } } as unknown as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.clearAllMocks()
	dbAny.__limitMock.mockResolvedValue([])
	dbAny.__orderByMock.mockResolvedValue([])
})

describe('projects/[slug]/deployments load', () => {
	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])
		await expect(load(makeLoadEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('returns deployments list for a known project', async () => {
		const dep = {
			id: 'dep-1',
			commitSha: 'abc1234',
			status: 'live',
			triggerType: 'push',
			imageTag: 'v1.0.0',
			createdAt: '2026-01-01T00:00:00Z',
			finishedAt: '2026-01-01T00:01:00Z'
		}
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'my-app' }])
		dbAny.__orderByMock.mockResolvedValueOnce([dep])

		const result = await load(makeLoadEvent())
		expect(result.deployments).toHaveLength(1)
		expect(result.deployments[0]).toMatchObject({ id: 'dep-1', status: 'live' })
	})

	it('deduplicates deployments by id', async () => {
		const dep = {
			id: 'dep-1',
			commitSha: 'abc1234',
			status: 'live',
			triggerType: 'push',
			imageTag: 'v1.0.0',
			createdAt: '2026-01-01T00:00:00Z',
			finishedAt: null
		}
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'my-app' }])
		dbAny.__orderByMock.mockResolvedValueOnce([dep, dep])

		const result = await load(makeLoadEvent())
		expect(result.deployments).toHaveLength(1)
	})

	it('returns empty deployments when none exist', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'my-app' }])
		dbAny.__orderByMock.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent())
		expect(result.deployments).toHaveLength(0)
	})
})
