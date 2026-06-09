import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

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
	deployments: 'deployments_table'
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

/* ── Tests ────────────────────────────────────────────────────────── */

describe('deployments page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
		dbAny.__orderByMock.mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('returns deployments list for valid project', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		const deps = [
			{
				id: 'd-1',
				commitSha: 'abc123',
				status: 'live',
				triggerType: 'push',
				imageTag: 'v1',
				createdAt: '2024-01-01',
				finishedAt: '2024-01-01'
			},
			{
				id: 'd-2',
				commitSha: 'def456',
				status: 'failed',
				triggerType: 'manual',
				imageTag: 'v2',
				createdAt: '2024-01-02',
				finishedAt: null
			}
		]

		dbAny.__limitMock.mockResolvedValueOnce([project])
		dbAny.__orderByMock.mockResolvedValueOnce(deps)

		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])

		expect(result.deployments).toHaveLength(2)
		expect(result.deployments[0].id).toBe('d-1')
		expect(result.deployments[0].status).toBe('live')
		expect(result.deployments[0].triggerType).toBe('push')
	})

	it('deduplicates deployments with the same id', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		const dep = {
			id: 'd-1',
			commitSha: 'abc123',
			status: 'live',
			triggerType: 'push',
			imageTag: 'v1',
			createdAt: '2024-01-01',
			finishedAt: null
		}

		dbAny.__limitMock.mockResolvedValueOnce([project])
		dbAny.__orderByMock.mockResolvedValueOnce([dep, dep])

		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])

		expect(result.deployments).toHaveLength(1)
	})

	it('returns empty array when project has no deployments', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		dbAny.__limitMock.mockResolvedValueOnce([project])
		dbAny.__orderByMock.mockResolvedValueOnce([])

		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])

		expect(result.deployments).toEqual([])
	})

	it('maps only the expected fields', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		const dep = {
			id: 'd-1',
			commitSha: 'abc123',
			status: 'live',
			triggerType: 'push',
			imageTag: 'v1',
			createdAt: '2024-01-01',
			finishedAt: '2024-01-01',
			extraField: 'should-not-appear'
		}

		dbAny.__limitMock.mockResolvedValueOnce([project])
		dbAny.__orderByMock.mockResolvedValueOnce([dep])

		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		const d = result.deployments[0]

		expect(d).toHaveProperty('id')
		expect(d).toHaveProperty('commitSha')
		expect(d).toHaveProperty('status')
		expect(d).toHaveProperty('triggerType')
		expect(d).toHaveProperty('imageTag')
		expect(d).toHaveProperty('createdAt')
		expect(d).toHaveProperty('finishedAt')
		expect(d).not.toHaveProperty('extraField')
	})
})
