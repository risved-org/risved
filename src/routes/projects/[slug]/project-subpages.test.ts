import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── shared mocks ─────────────────────────────────────────────────── */

const mockLimitFn = vi.hoisted(() => vi.fn())
const mockOrderByFn = vi.hoisted(() => vi.fn())
const mockWhereFn = vi.hoisted(() => vi.fn())

vi.mock('$lib/server/db', () => {
	const orderByMock = mockOrderByFn
	const limitMock = mockLimitFn
	const whereMock = mockWhereFn
	whereMock.mockReturnValue({ limit: limitMock, orderBy: orderByMock })
	orderByMock.mockReturnValue({ limit: limitMock })
	limitMock.mockResolvedValue([])
	const fromMock = vi.fn(() => ({ where: whereMock, orderBy: orderByMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return { db: { select: selectMock } }
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	desc: vi.fn(() => 'desc_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	healthEvents: 'health_events_table'
}))

vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: vi.fn().mockResolvedValue([])
}))

import { load as loadLogs } from './logs/+page.server'
import { load as loadDeployments } from './deployments/+page.server'
import { load as loadMetrics } from './metrics/+page.server'
import { getProjectMetrics } from '$lib/server/metrics'

function makeParams(slug: string) {
	return { params: { slug }, url: new URL('http://localhost/projects/' + slug) } as Parameters<
		typeof loadLogs
	>[0]
}

/* ── logs/+page.server.ts ─────────────────────────────────────────── */

describe('logs page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn })
		mockOrderByFn.mockReturnValue({ limit: mockLimitFn })
		mockLimitFn.mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		mockLimitFn.mockResolvedValueOnce([])
		await expect(loadLogs(makeParams('not-found'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns empty object when project found', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'my-app' }])
		const result = await loadLogs(makeParams('my-app'))
		expect(result).toEqual({})
	})
})

/* ── deployments/+page.server.ts ──────────────────────────────────── */

describe('deployments page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn })
		mockOrderByFn.mockReturnValue({ limit: mockLimitFn })
		mockLimitFn.mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		mockLimitFn.mockResolvedValueOnce([])
		await expect(loadDeployments(makeParams('ghost'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns deployments mapped to expected shape', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'app' }])
		mockOrderByFn.mockResolvedValueOnce([
			{
				id: 'd1',
				commitSha: 'abc123',
				status: 'success',
				triggerType: 'manual',
				imageTag: 'img-1',
				createdAt: '2026-01-01',
				finishedAt: '2026-01-01'
			}
		])

		const result = await loadDeployments(makeParams('app'))
		expect(result.deployments).toHaveLength(1)
		expect(result.deployments[0]).toMatchObject({
			id: 'd1',
			commitSha: 'abc123',
			status: 'success',
			triggerType: 'manual',
			imageTag: 'img-1'
		})
	})

	it('deduplicates deployments with repeated ids', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'app' }])
		const dep = {
			id: 'd1',
			commitSha: 'abc',
			status: 'success',
			triggerType: 'auto',
			imageTag: null,
			createdAt: '2026-01-01',
			finishedAt: null
		}
		mockOrderByFn.mockResolvedValueOnce([dep, dep])

		const result = await loadDeployments(makeParams('app'))
		expect(result.deployments).toHaveLength(1)
	})
})

/* ── metrics/+page.server.ts ──────────────────────────────────────── */

describe('metrics page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn })
		mockOrderByFn.mockReturnValue({ limit: mockLimitFn })
		mockLimitFn.mockResolvedValue([])
		vi.mocked(getProjectMetrics).mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		mockLimitFn.mockResolvedValueOnce([])
		await expect(
			loadMetrics(makeParams('missing') as Parameters<typeof loadMetrics>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('defaults to 24-hour window', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'app' }])
		mockLimitFn.mockResolvedValueOnce([])

		const result = await loadMetrics(makeParams('app') as Parameters<typeof loadMetrics>[0])
		expect(result.hours).toBe(24)
		expect(getProjectMetrics).toHaveBeenCalledWith('p1', 24)
	})

	it('accepts valid hours query param', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'app' }])
		mockLimitFn.mockResolvedValueOnce([])

		const event = {
			params: { slug: 'app' },
			url: new URL('http://localhost/projects/app?hours=48')
		} as Parameters<typeof loadMetrics>[0]
		const result = await loadMetrics(event)
		expect(result.hours).toBe(48)
		expect(getProjectMetrics).toHaveBeenCalledWith('p1', 48)
	})

	it('falls back to 24 for invalid hours param', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'app' }])
		mockLimitFn.mockResolvedValueOnce([])

		const event = {
			params: { slug: 'app' },
			url: new URL('http://localhost/projects/app?hours=999')
		} as Parameters<typeof loadMetrics>[0]
		const result = await loadMetrics(event)
		expect(result.hours).toBe(24)
	})

	it('maps healthEvents to expected shape', async () => {
		mockLimitFn.mockResolvedValueOnce([{ id: 'p1', slug: 'app' }])
		mockLimitFn.mockResolvedValueOnce([
			{ id: 'ev1', event: 'healthy', message: 'OK', createdAt: '2026-01-01', projectId: 'p1' }
		])

		const result = await loadMetrics(makeParams('app') as Parameters<typeof loadMetrics>[0])
		expect(result.healthEvents).toHaveLength(1)
		expect(result.healthEvents[0]).toMatchObject({
			id: 'ev1',
			event: 'healthy',
			message: 'OK'
		})
	})
})
