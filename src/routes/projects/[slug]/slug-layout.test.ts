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
	domains: 'domains_table',
	deployments: 'deployments_table'
}))

vi.mock('$lib/server/health', () => {
	const mockGet = vi.fn()
	return { getHealthMonitor: vi.fn().mockReturnValue({ get: mockGet, __mockGet: mockGet }) }
})

import { db } from '$lib/server/db'
import { getHealthMonitor } from '$lib/server/health'
import { load } from './+layout.server'

const dbAny = db as unknown as { __selectMock: ReturnType<typeof vi.fn> }

function healthGet() {
	return (getHealthMonitor() as unknown as { __mockGet: ReturnType<typeof vi.fn> }).__mockGet
}

function setupSelects(
	projectRows: unknown[],
	domainRows: unknown[],
	deploymentRows: unknown[]
) {
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
				where: vi.fn().mockResolvedValue(domainRows)
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

function makeEvent(slug: string) {
	return { params: { slug } } as Parameters<typeof load>[0]
}

const baseProject = {
	id: 'p-1',
	name: 'Test App',
	slug: 'test-app',
	repoUrl: 'https://github.com/org/repo',
	branch: 'main',
	frameworkId: null,
	domain: null,
	port: 3000
}

describe('project slug layout load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__selectMock.mockReset()
	})

	it('throws 404 when project not found', async () => {
		setupSelects([], [], [])
		await expect(load(makeEvent('nonexistent'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns project data with stopped status when no deployments', async () => {
		setupSelects([baseProject], [], [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.name).toBe('Test App')
		expect(result.project.status).toBe('stopped')
	})

	it('returns live status from latest deployment', async () => {
		const dep = { status: 'live', commitSha: 'abc123', createdAt: '2026-01-01T00:00:00Z' }
		setupSelects([baseProject], [], [dep])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.status).toBe('live')
	})

	it('shows live when latest is in-progress but a previous deployment is live', async () => {
		const deps = [
			{ status: 'building', commitSha: 'def', createdAt: '2026-01-02T00:00:00Z' },
			{ status: 'live', commitSha: 'abc', createdAt: '2026-01-01T00:00:00Z' }
		]
		setupSelects([baseProject], [], deps)
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.status).toBe('live')
	})

	it('uses primary domain from domains table', async () => {
		const doms = [
			{ id: 'd1', hostname: 'other.example.com', isPrimary: false },
			{ id: 'd2', hostname: 'primary.example.com', isPrimary: true }
		]
		setupSelects([{ ...baseProject, domain: 'fallback.example.com' }], doms, [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.domain).toBe('primary.example.com')
	})

	it('falls back to project.domain when no domains in table', async () => {
		setupSelects([{ ...baseProject, domain: 'fallback.example.com' }], [], [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.domain).toBe('fallback.example.com')
	})

	it('returns null domain when neither source provides one', async () => {
		setupSelects([baseProject], [], [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.domain).toBeNull()
	})

	it('maps sveltekit frameworkId to readable name', async () => {
		setupSelects([{ ...baseProject, frameworkId: 'sveltekit' }], [], [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.framework).toBe('SvelteKit')
	})

	it('returns null framework when frameworkId is null', async () => {
		setupSelects([baseProject], [], [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.framework).toBeNull()
	})

	it('returns containerHealth when monitor has data', async () => {
		setupSelects([baseProject], [], [])
		healthGet().mockReturnValue({
			healthy: true,
			consecutiveFailures: 0,
			lastCheckAt: '2026-01-01T00:00:00Z',
			lastRestartAt: null,
			totalRestarts: 2
		})

		const result = await load(makeEvent('test-app'))
		expect(result.containerHealth).not.toBeNull()
		expect(result.containerHealth?.healthy).toBe(true)
		expect(result.containerHealth?.totalRestarts).toBe(2)
	})

	it('returns null containerHealth when monitor has no entry', async () => {
		setupSelects([baseProject], [], [])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.containerHealth).toBeNull()
	})

	it('sets lastCommitSha from live deployment', async () => {
		const dep = { status: 'live', commitSha: 'abc', createdAt: '2026-03-01T00:00:00Z' }
		setupSelects([baseProject], [], [dep])
		healthGet().mockReturnValue(null)

		const result = await load(makeEvent('test-app'))
		expect(result.project.lastCommitSha).toBe('abc')
		expect(result.project.lastDeployedAt).toBe('2026-03-01T00:00:00Z')
	})
})
