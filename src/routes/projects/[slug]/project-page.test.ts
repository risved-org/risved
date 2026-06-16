import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const selectMock = vi.fn()
	return { db: { select: selectMock, __selectMock: selectMock } }
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

const dbAny = db as unknown as { __selectMock: ReturnType<typeof vi.fn> }

function makeEvent(slug = 'my-app') {
	return { params: { slug } } as Parameters<typeof load>[0]
}

function setupSelects(projectRows: unknown[], deploymentRows: unknown[]) {
	dbAny.__selectMock
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(projectRows)
				})
			})
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue(deploymentRows)
					})
				})
			})
		})
}

describe('project overview page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__selectMock.mockReset()
	})

	it('throws 404 when project not found', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})

		await expect(load(makeEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('returns deployments for found project', async () => {
		const project = { id: 'p-1', name: 'App', slug: 'my-app' }
		const dep = {
			id: 'd-1',
			commitSha: 'abc123',
			status: 'live',
			triggerType: 'push',
			imageTag: 'my-app:abc',
			createdAt: '2026-01-01T00:00:00Z',
			finishedAt: '2026-01-01T00:05:00Z'
		}
		setupSelects([project], [dep])

		const result = await load(makeEvent())
		expect(result.deployments).toHaveLength(1)
		expect(result.deployments[0].id).toBe('d-1')
		expect(result.deployments[0].commitSha).toBe('abc123')
		expect(result.deployments[0].status).toBe('live')
		expect(result.deployments[0].triggerType).toBe('push')
		expect(result.deployments[0].imageTag).toBe('my-app:abc')
	})

	it('returns empty deployments when project has none', async () => {
		setupSelects([{ id: 'p-1', name: 'App', slug: 'my-app' }], [])

		const result = await load(makeEvent())
		expect(result.deployments).toHaveLength(0)
	})

	it('deduplicates deployments with the same id', async () => {
		const project = { id: 'p-1', name: 'App', slug: 'my-app' }
		const dep = { id: 'd-1', commitSha: 'abc', status: 'live', triggerType: 'push', imageTag: 'tag', createdAt: '2026', finishedAt: null }
		setupSelects([project], [dep, dep])

		const result = await load(makeEvent())
		expect(result.deployments).toHaveLength(1)
	})

	it('preserves finishedAt null when deployment is still running', async () => {
		const project = { id: 'p-1', name: 'App', slug: 'my-app' }
		const dep = { id: 'd-1', commitSha: 'abc', status: 'running', triggerType: 'push', imageTag: null, createdAt: '2026-01-01T00:00:00Z', finishedAt: null }
		setupSelects([project], [dep])

		const result = await load(makeEvent())
		expect(result.deployments[0].finishedAt).toBeNull()
	})
})
