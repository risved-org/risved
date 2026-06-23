import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ───────────────────────────────────────────────── */
const { mockGet } = vi.hoisted(() => ({
	mockGet: vi.fn().mockReturnValue(undefined)
}))

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn().mockReturnValue({ get: mockGet })
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_expr'),
	desc: vi.fn(() => 'desc_expr')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' },
	domains: { id: 'id', projectId: 'project_id', isPrimary: 'is_primary', hostname: 'hostname' },
	deployments: { id: 'id', projectId: 'project_id', status: 'status', createdAt: 'created_at' }
}))

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn() } }))

import { db } from '$lib/server/db'
import { getHealthMonitor } from '$lib/server/health'
import { load } from './+layout.server'

/* ── Helpers ─────────────────────────────────────────────────────── */

const mockProject = {
	id: 'proj-1',
	name: 'My App',
	slug: 'my-app',
	repoUrl: 'https://github.com/user/my-app',
	branch: 'main',
	frameworkId: 'sveltekit',
	domain: 'my-app.example.com',
	port: 3001
}

function setupProjectSelect(rows: unknown[]) {
	vi.mocked(db.select).mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	} as never)
}

function setupDomainsSelect(rows: unknown[]) {
	vi.mocked(db.select).mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(rows)
		})
	} as never)
}

function setupDeploymentsSelect(rows: unknown[]) {
	vi.mocked(db.select).mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(rows)
				})
			})
		})
	} as never)
}

function setupAllSelects(
	projectRows: unknown[],
	domainRows: unknown[],
	deploymentRows: unknown[]
) {
	setupProjectSelect(projectRows)
	setupDomainsSelect(domainRows)
	setupDeploymentsSelect(deploymentRows)
}

function makeEvent(slug: string) {
	return { params: { slug } } as Parameters<typeof load>[0]
}

/* ── Tests ───────────────────────────────────────────────────────── */

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(getHealthMonitor).mockReturnValue({ get: mockGet } as never)
	mockGet.mockReturnValue(undefined)
})

describe('project layout load — 404', () => {
	it('throws 404 when project is not found', async () => {
		setupProjectSelect([])
		await expect(load(makeEvent('nonexistent'))).rejects.toMatchObject({ status: 404 })
	})
})

describe('project layout load — success', () => {
	it('returns project fields when found', async () => {
		setupAllSelects([mockProject], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.id).toBe('proj-1')
		expect(data.project.name).toBe('My App')
		expect(data.project.slug).toBe('my-app')
		expect(data.project.port).toBe(3001)
	})

	it('maps frameworkId to human-readable name', async () => {
		setupAllSelects([mockProject], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.framework).toBe('SvelteKit')
	})

	it('returns raw frameworkId when not in lookup table', async () => {
		setupAllSelects([{ ...mockProject, frameworkId: 'unknown-fw' }], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.framework).toBe('unknown-fw')
	})

	it('returns null framework when frameworkId is null', async () => {
		setupAllSelects([{ ...mockProject, frameworkId: null }], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.framework).toBeNull()
	})

	it('status defaults to stopped when no deployments', async () => {
		setupAllSelects([mockProject], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.status).toBe('stopped')
	})

	it('status reflects the most recent deployment', async () => {
		const deps = [{ status: 'live', commitSha: 'abc1234', createdAt: new Date() }]
		setupAllSelects([mockProject], [], deps)
		const data = await load(makeEvent('my-app'))
		expect(data.project.status).toBe('live')
	})

	it('shows live status when in-progress deployment and a previous live deployment exist', async () => {
		const deps = [
			{ status: 'building', commitSha: 'new1', createdAt: new Date() },
			{ status: 'live', commitSha: 'old1', createdAt: new Date(Date.now() - 60000) }
		]
		setupAllSelects([mockProject], [], deps)
		const data = await load(makeEvent('my-app'))
		expect(data.project.status).toBe('live')
	})

	it('uses primary domain over project.domain when available', async () => {
		const doms = [
			{ id: 'd-1', hostname: 'custom.example.com', isPrimary: true },
			{ id: 'd-2', hostname: 'other.example.com', isPrimary: false }
		]
		setupAllSelects([mockProject], doms, [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.domain).toBe('custom.example.com')
	})

	it('falls back to project.domain when no domains table entry is primary', async () => {
		const doms = [{ id: 'd-1', hostname: 'other.example.com', isPrimary: false }]
		setupAllSelects([mockProject], doms, [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.domain).toBe('my-app.example.com')
	})

	it('returns container health when monitor has data', async () => {
		const health = {
			healthy: true,
			consecutiveFailures: 0,
			lastCheckAt: new Date(),
			lastRestartAt: null,
			totalRestarts: 0
		}
		mockGet.mockReturnValue(health)
		setupAllSelects([mockProject], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.containerHealth).toMatchObject({ healthy: true, consecutiveFailures: 0 })
	})

	it('returns null containerHealth when monitor has no data for project', async () => {
		setupAllSelects([mockProject], [], [])
		const data = await load(makeEvent('my-app'))
		expect(data.containerHealth).toBeNull()
	})

	it('returns lastCommitSha from live deployment', async () => {
		const deps = [{ status: 'live', commitSha: 'deadbeef', createdAt: new Date() }]
		setupAllSelects([mockProject], [], deps)
		const data = await load(makeEvent('my-app'))
		expect(data.project.lastCommitSha).toBe('deadbeef')
	})

	it('sorts allDomains with primary first', async () => {
		const doms = [
			{ id: 'd-1', hostname: 'secondary.example.com', isPrimary: false },
			{ id: 'd-2', hostname: 'primary.example.com', isPrimary: true }
		]
		setupAllSelects([mockProject], doms, [])
		const data = await load(makeEvent('my-app'))
		expect(data.project.domains[0].hostname).toBe('primary.example.com')
		expect(data.project.domains[1].hostname).toBe('secondary.example.com')
	})
})
