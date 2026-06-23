import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn() }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_result'),
	desc: vi.fn(() => 'desc_result')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	domains: 'domains_table',
	deployments: 'deployments_table'
}))

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) })
}))

import { db } from '$lib/server/db'
import { getHealthMonitor } from '$lib/server/health'
import { load } from './+layout.server'

const dbSelect = db.select as ReturnType<typeof vi.fn>

const baseProject = {
	id: 'proj-1',
	name: 'Test App',
	slug: 'test-app',
	repoUrl: 'https://github.com/user/test.git',
	branch: 'main',
	frameworkId: 'sveltekit',
	domain: 'test-app.example.com',
	port: 3001
}

function setupDbCalls(
	projectRows: unknown[] = [baseProject],
	domainRows: unknown[] = [],
	deploymentRows: unknown[] = []
) {
	dbSelect.mockReset()
	dbSelect
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

describe('+layout.server load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(getHealthMonitor as ReturnType<typeof vi.fn>).mockReturnValue({ get: vi.fn().mockReturnValue(null) })
	})

	it('throws 404 when project not found', async () => {
		setupDbCalls([])
		await expect(
			load({ params: { slug: 'missing' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('returns project data with stopped status when no deployments', async () => {
		setupDbCalls()
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.name).toBe('Test App')
		expect(result.project.slug).toBe('test-app')
		expect(result.project.status).toBe('stopped')
		expect(result.project.framework).toBe('SvelteKit')
		expect(result.containerHealth).toBeNull()
	})

	it('returns live status from latest deployment', async () => {
		setupDbCalls(
			[baseProject],
			[],
			[{ status: 'live', commitSha: 'abc123', createdAt: '2024-01-01T00:00:00Z' }]
		)
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.status).toBe('live')
		expect(result.project.lastCommitSha).toBe('abc123')
	})

	it('returns failed status when latest deployment failed', async () => {
		setupDbCalls(
			[baseProject],
			[],
			[{ status: 'failed', commitSha: 'xyz', createdAt: '2024-01-01T00:00:00Z' }]
		)
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.status).toBe('failed')
	})

	it('shows live status when latest is running but a prior deployment is live', async () => {
		setupDbCalls(
			[baseProject],
			[],
			[
				{ status: 'running', commitSha: 'new', createdAt: '2024-01-02T00:00:00Z' },
				{ status: 'live', commitSha: 'old', createdAt: '2024-01-01T00:00:00Z' }
			]
		)
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.status).toBe('live')
	})

	it('includes container health data when monitor has state', async () => {
		const healthData = {
			healthy: true,
			consecutiveFailures: 0,
			lastCheckAt: '2024-01-01T00:00:00Z',
			lastRestartAt: null,
			totalRestarts: 0
		}
		;(getHealthMonitor as ReturnType<typeof vi.fn>).mockReturnValue({
			get: vi.fn().mockReturnValue(healthData)
		})
		setupDbCalls()
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.containerHealth).toMatchObject({ healthy: true, consecutiveFailures: 0 })
	})

	it('picks primary domain from domains table', async () => {
		setupDbCalls(
			[baseProject],
			[
				{ id: 'd-1', hostname: 'secondary.com', isPrimary: false },
				{ id: 'd-2', hostname: 'primary.example.com', isPrimary: true }
			],
			[]
		)
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.domain).toBe('primary.example.com')
	})

	it('falls back to project.domain when no domains in table', async () => {
		setupDbCalls()
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.domain).toBe('test-app.example.com')
	})

	it('returns null domain when no domains and project.domain is null', async () => {
		setupDbCalls([{ ...baseProject, domain: null }])
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.domain).toBeNull()
	})

	it('maps unknown frameworkId to itself', async () => {
		setupDbCalls([{ ...baseProject, frameworkId: 'custom-framework' }])
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.framework).toBe('custom-framework')
	})

	it('returns null framework when frameworkId is null', async () => {
		setupDbCalls([{ ...baseProject, frameworkId: null }])
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.framework).toBeNull()
	})

	it('returns all domains sorted with primary first', async () => {
		setupDbCalls(
			[baseProject],
			[
				{ id: 'd-1', hostname: 'extra.com', isPrimary: false },
				{ id: 'd-2', hostname: 'main.example.com', isPrimary: true }
			],
			[]
		)
		const result = await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		expect(result.project.domains[0].isPrimary).toBe(true)
		expect(result.project.domains[0].hostname).toBe('main.example.com')
	})
})
