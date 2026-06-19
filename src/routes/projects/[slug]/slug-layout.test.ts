import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() }
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

const mockHealthMonitor = { get: vi.fn().mockReturnValue(null) }

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn(() => mockHealthMonitor)
}))

import { load } from './+layout.server'

type LoadEvent = Parameters<typeof load>[0]

function makeEvent(slug: string): LoadEvent {
	return { params: { slug } } as LoadEvent
}

function setupSelectChain(rows: unknown[]) {
	const chain = {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			}),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	}
	mockDb.select.mockReturnValue(chain)
	return chain
}

beforeEach(() => {
	vi.clearAllMocks()
	mockHealthMonitor.get.mockReturnValue(null)
})

describe('[slug] layout load', () => {
	it('throws 404 when project not found', async () => {
		setupSelectChain([])

		await expect(load(makeEvent('ghost'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns project data with stopped status when no deployments', async () => {
		const project = {
			id: 'p1', name: 'My App', slug: 'my-app', repoUrl: 'https://github.com/a/b',
			branch: 'main', frameworkId: 'sveltekit', domain: null, port: 3001,
			buildCommand: null, startCommand: null, releaseCommand: null,
			gitConnectionId: null, previewLimit: 3
		}

		mockDb.select
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([project]) })
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([])
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([])
						})
					})
				})
			})

		const result = await load(makeEvent('my-app'))
		expect(result.project.name).toBe('My App')
		expect(result.project.status).toBe('stopped')
		expect(result.project.framework).toBe('SvelteKit')
		expect(result.containerHealth).toBeNull()
	})

	it('shows live status when latest deployment is live', async () => {
		const project = {
			id: 'p2', name: 'Live App', slug: 'live-app', repoUrl: 'https://github.com/a/c',
			branch: 'main', frameworkId: null, domain: 'live.example.com', port: 3002,
			buildCommand: null, startCommand: null, releaseCommand: null,
			gitConnectionId: null, previewLimit: 3
		}
		const deployment = { status: 'live', commitSha: 'deadbeef', createdAt: '2026-01-01T00:00:00Z' }

		mockDb.select
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([project]) })
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([])
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([deployment])
						})
					})
				})
			})

		const result = await load(makeEvent('live-app'))
		expect(result.project.status).toBe('live')
		expect(result.project.lastCommitSha).toBe('deadbeef')
	})

	it('shows live status when building but old deployment is live', async () => {
		const project = {
			id: 'p3', name: 'Building App', slug: 'building-app', repoUrl: 'https://github.com/a/d',
			branch: 'main', frameworkId: null, domain: null, port: 3003,
			buildCommand: null, startCommand: null, releaseCommand: null,
			gitConnectionId: null, previewLimit: 3
		}
		const deployments = [
			{ status: 'building', commitSha: 'new', createdAt: '2026-01-02T00:00:00Z' },
			{ status: 'live', commitSha: 'old', createdAt: '2026-01-01T00:00:00Z' }
		]

		mockDb.select
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([project]) })
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([])
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue(deployments)
						})
					})
				})
			})

		const result = await load(makeEvent('building-app'))
		expect(result.project.status).toBe('live')
	})

	it('returns container health when monitor has data', async () => {
		const project = {
			id: 'p4', name: 'Healthy', slug: 'healthy', repoUrl: 'https://github.com/a/e',
			branch: 'main', frameworkId: null, domain: null, port: 3004,
			buildCommand: null, startCommand: null, releaseCommand: null,
			gitConnectionId: null, previewLimit: 3
		}

		mockHealthMonitor.get.mockReturnValue({
			healthy: true,
			consecutiveFailures: 0,
			lastCheckAt: '2026-01-01T00:00:00Z',
			lastRestartAt: null,
			totalRestarts: 0
		})

		mockDb.select
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([project]) })
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([])
				})
			})
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([])
						})
					})
				})
			})

		const result = await load(makeEvent('healthy'))
		expect(result.containerHealth).toMatchObject({ healthy: true, consecutiveFailures: 0 })
	})
})
