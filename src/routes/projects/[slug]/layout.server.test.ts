import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}))

const mockHealthMonitor = vi.hoisted(() => ({
	get: vi.fn().mockReturnValue(null)
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	domains: 'domains_table',
	deployments: 'deployments_table'
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	desc: vi.fn(() => 'desc_fn')
}))

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn(() => mockHealthMonitor)
}))

import { load } from './+layout.server'

/* ── Helpers ──────────────────────────────────────────────────────── */

/**
 * Builds a mock select chain where where() is both directly awaitable
 * (for bare `await db.select().from(x).where(y)` calls) and chainable
 * via .limit() / .orderBy().limit().
 */
function buildChain(rows: unknown[]) {
	const whereResult = Object.assign(Promise.resolve(rows), {
		limit: vi.fn().mockResolvedValue(rows),
		orderBy: vi.fn().mockReturnValue({
			limit: vi.fn().mockResolvedValue(rows)
		})
	})
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue(whereResult),
			orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) })
		})
	}
}

const baseProject = {
	id: 'proj-1',
	name: 'My App',
	slug: 'my-app',
	repoUrl: 'https://github.com/user/my-app',
	branch: 'main',
	frameworkId: 'sveltekit',
	domain: 'my-app.example.com',
	port: 3001
}

function setupSuccess(projectRows = [baseProject], domainRows: unknown[] = [], deploymentRows: unknown[] = []) {
	mockDb.select.mockReturnValueOnce(buildChain(projectRows))  // project lookup
	mockDb.select.mockReturnValueOnce(buildChain(domainRows))   // domains
	mockDb.select.mockReturnValueOnce(buildChain(deploymentRows)) // recent deployments
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('project layout load', () => {
	beforeEach(() => vi.clearAllMocks())

	it('throws 404 when project not found', async () => {
		mockDb.select.mockReturnValueOnce(buildChain([]))
		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('returns project data on success', async () => {
		setupSuccess()
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.id).toBe('proj-1')
		expect(result.project.name).toBe('My App')
		expect(result.project.slug).toBe('my-app')
	})

	it('maps frameworkId to display name', async () => {
		setupSuccess()
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.framework).toBe('SvelteKit')
	})

	it('returns raw frameworkId for unknown frameworks', async () => {
		setupSuccess([{ ...baseProject, frameworkId: 'custom-fw' }])
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.framework).toBe('custom-fw')
	})

	it('returns null framework when frameworkId is absent', async () => {
		setupSuccess([{ ...baseProject, frameworkId: null }])
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.framework).toBeNull()
	})

	it('sets status from latest deployment', async () => {
		setupSuccess(undefined, [], [{ status: 'live', commitSha: 'abc123', createdAt: '2024-01-01' }])
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.status).toBe('live')
	})

	it('defaults status to stopped when no deployments', async () => {
		setupSuccess()
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.status).toBe('stopped')
	})

	it('shows live status when in-progress but a prior deployment is live', async () => {
		const deps = [
			{ status: 'building', commitSha: 'def456', createdAt: '2024-01-02' },
			{ status: 'live', commitSha: 'abc123', createdAt: '2024-01-01' }
		]
		setupSuccess(undefined, [], deps)
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.status).toBe('live')
	})

	it('uses primary domain from domains table when available', async () => {
		const doms = [
			{ id: 'd-1', hostname: 'primary.example.com', isPrimary: true },
			{ id: 'd-2', hostname: 'alias.example.com', isPrimary: false }
		]
		setupSuccess(undefined, doms)
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.domain).toBe('primary.example.com')
	})

	it('falls back to project.domain when no primary domain in table', async () => {
		setupSuccess(undefined, [])
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.domain).toBe('my-app.example.com')
	})

	it('sorts domains with primary first', async () => {
		const doms = [
			{ id: 'd-1', hostname: 'alias.example.com', isPrimary: false },
			{ id: 'd-2', hostname: 'primary.example.com', isPrimary: true }
		]
		setupSuccess(undefined, doms)
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.domains[0].isPrimary).toBe(true)
		expect(result.project.domains[0].hostname).toBe('primary.example.com')
	})

	it('returns null containerHealth when monitor has no entry', async () => {
		mockHealthMonitor.get.mockReturnValueOnce(null)
		setupSuccess()
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.containerHealth).toBeNull()
	})

	it('returns containerHealth data when monitor has an entry', async () => {
		const health = {
			healthy: true,
			consecutiveFailures: 0,
			lastCheckAt: '2024-01-01T00:00:00Z',
			lastRestartAt: null,
			totalRestarts: 0
		}
		mockHealthMonitor.get.mockReturnValueOnce(health)
		setupSuccess()
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.containerHealth?.healthy).toBe(true)
		expect(result.containerHealth?.consecutiveFailures).toBe(0)
	})

	it('exposes lastCommitSha from live deployment', async () => {
		const deps = [{ status: 'live', commitSha: 'abc123', createdAt: '2024-01-01' }]
		setupSuccess(undefined, [], deps)
		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])
		expect(result.project.lastCommitSha).toBe('abc123')
	})
})
