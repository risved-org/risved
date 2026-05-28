import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockGetSetting, mockRunPipeline, mockDockerStop, mockCreateCaddyClient } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
	mockGetSetting: vi.fn(),
	mockRunPipeline: vi.fn(),
	mockDockerStop: vi.fn(),
	mockCreateCaddyClient: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	previewDeployments: {
		id: 'id',
		projectId: 'project_id',
		prNumber: 'pr_number',
		status: 'status',
		port: 'port',
		createdAt: 'created_at'
	},
	deployments: { id: 'id', status: 'status' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((_a: unknown, _b: unknown) => 'eq'),
	and: vi.fn((...args: unknown[]) => args),
	asc: vi.fn((col: unknown) => col)
}))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/pipeline', () => ({ runPipeline: mockRunPipeline }))
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({})),
	dockerStop: mockDockerStop
}))
vi.mock('$lib/server/caddy', () => ({
	createCaddyClient: mockCreateCaddyClient,
	CaddyClient: vi.fn()
}))

import {
	buildPreviewDomain,
	allocatePreviewPort,
	createPreview,
	cleanupPreview,
	cleanupPrPreviews,
	enforcePreviewLimit,
	listPreviews
} from './index'

function chainable(result: unknown[]) {
	const chain: Record<string, unknown> = {
		then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
			Promise.resolve(result).then(resolve, reject),
		catch: vi.fn().mockResolvedValue(undefined)
	}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.orderBy = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockResolvedValue(result)
	chain.returning = vi.fn().mockResolvedValue(result)
	chain.set = vi.fn().mockReturnValue(chain)
	chain.values = vi.fn().mockReturnValue(chain)
	return chain
}

function resetDb() {
	mockDb.select.mockImplementation(() => chainable([]))
	mockDb.insert.mockImplementation(() => chainable([]))
	mockDb.update.mockImplementation(() => chainable([]))
}

const PROJECT = {
	id: 'proj-1',
	slug: 'my-app',
	repoUrl: 'https://github.com/test/repo',
	gitConnectionId: 'conn-1',
	previewLimit: 3,
	frameworkId: 'sveltekit',
	tier: 'free',
	buildCommand: null,
	startCommand: null,
	releaseCommand: null
}

describe('buildPreviewDomain', () => {
	it('builds domain as pr-{number}.{slug}.{baseDomain}', () => {
		expect(buildPreviewDomain(42, 'my-app', 'risved.example.com')).toBe(
			'pr-42.my-app.risved.example.com'
		)
	})

	it('handles single-digit PR numbers', () => {
		expect(buildPreviewDomain(1, 'app', 'test.io')).toBe('pr-1.app.test.io')
	})

	it('handles large PR numbers', () => {
		expect(buildPreviewDomain(9999, 'project', 'deploy.dev')).toBe('pr-9999.project.deploy.dev')
	})
})

describe('preview types', () => {
	it('module loads successfully', async () => {
		const types = await import('./types')
		expect(types).toBeDefined()
	})
})

describe('allocatePreviewPort', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetDb()
	})

	it('returns 4001 when no ports are in use', async () => {
		mockDb.select.mockImplementation(() => chainable([]))
		const port = await allocatePreviewPort()
		expect(port).toBe(4001)
	})

	it('skips used ports and returns next available', async () => {
		mockDb.select.mockImplementation(() => chainable([{ port: 4001 }, { port: 4002 }]))
		const port = await allocatePreviewPort()
		expect(port).toBe(4003)
	})

	it('throws when all ports in range are exhausted', async () => {
		const allPorts = Array.from({ length: 999 }, (_, i) => ({ port: 4001 + i }))
		mockDb.select.mockImplementation(() => chainable(allPorts))
		await expect(allocatePreviewPort()).rejects.toThrow('No available preview ports')
	})

	it('ignores null ports from DB', async () => {
		mockDb.select.mockImplementation(() => chainable([{ port: null }, { port: 4001 }]))
		const port = await allocatePreviewPort()
		expect(port).toBe(4002)
	})
})

describe('listPreviews', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetDb()
	})

	it('returns active previews for a project', async () => {
		const previews = [{ id: 'prev-1', prNumber: 42, status: 'active' }]
		mockDb.select.mockImplementation(() => chainable(previews))
		const result = await listPreviews('proj-1')
		expect(result).toEqual(previews)
	})

	it('returns empty array when no previews exist', async () => {
		mockDb.select.mockImplementation(() => chainable([]))
		const result = await listPreviews('proj-1')
		expect(result).toEqual([])
	})
})

describe('createPreview', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetDb()
		mockRunPipeline.mockResolvedValue({ success: true, deploymentId: 'dep-id', commitSha: 'abc' })
		mockGetSetting.mockResolvedValue('risved.example.com')
	})

	it('returns error when hostname is not configured', async () => {
		mockGetSetting.mockResolvedValue(null)
		const result = await createPreview(PROJECT, 1, 'Fix bug', 'fix/bug', null)
		expect(result).toEqual({ success: false, error: 'No hostname configured' })
	})

	it('creates a new preview and returns success', async () => {
		/* no existing preview */
		mockDb.select
			.mockImplementationOnce(() => chainable([]))
			/* enforcePreviewLimit → active count query */
			.mockImplementationOnce(() => chainable([]))
			/* allocatePreviewPort */
			.mockImplementationOnce(() => chainable([]))
		mockDb.insert.mockImplementation(() => chainable([{ id: 'preview-new' }]))

		const result = await createPreview(PROJECT, 5, 'Add feature', 'feat/x', 'sha1')
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.previewId).toBe('preview-new')
			expect(result.domain).toContain('pr-5')
		}
	})

	it('updates an existing active preview and returns success', async () => {
		const existing = {
			id: 'preview-exist',
			port: 4010,
			prNumber: 3,
			status: 'active',
			containerName: 'my-app-pr-3'
		}
		mockDb.select.mockImplementationOnce(() => chainable([existing]))

		const result = await createPreview(PROJECT, 3, 'Update', 'feat/y', 'sha2')
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.previewId).toBe('preview-exist')
			expect(result.port).toBe(4010)
		}
		expect(mockDb.update).toHaveBeenCalled()
	})
})

describe('cleanupPreview', () => {
	const PREVIEW = {
		id: 'prev-1',
		containerName: 'my-app-pr-7',
		domain: 'pr-7.my-app.risved.example.com',
		deploymentId: 'dep-1',
		status: 'active',
		port: 4001,
		projectId: 'proj-1',
		prNumber: 7
	}

	beforeEach(() => {
		vi.clearAllMocks()
		resetDb()
		mockDockerStop.mockResolvedValue(undefined)
		mockCreateCaddyClient.mockReturnValue({ removeRoute: vi.fn().mockResolvedValue(undefined) })
	})

	it('returns early when preview is not found', async () => {
		mockDb.select.mockImplementation(() => chainable([]))
		await cleanupPreview('missing-id')
		expect(mockDockerStop).not.toHaveBeenCalled()
	})

	it('stops container and marks preview cleaned', async () => {
		mockDb.select.mockImplementation(() => chainable([PREVIEW]))

		await cleanupPreview('prev-1')

		expect(mockDockerStop).toHaveBeenCalledWith(expect.anything(), 'my-app-pr-7', 10)
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('accepts an external caddy client', async () => {
		mockDb.select.mockImplementation(() => chainable([PREVIEW]))
		const caddy = { removeRoute: vi.fn().mockResolvedValue(undefined) }

		await cleanupPreview('prev-1', caddy as never)
		expect(caddy.removeRoute).toHaveBeenCalledWith('pr-7.my-app.risved.example.com')
		expect(mockCreateCaddyClient).not.toHaveBeenCalled()
	})

	it('handles preview with no container or domain', async () => {
		const minimal = { ...PREVIEW, containerName: null, domain: null, deploymentId: null }
		mockDb.select.mockImplementation(() => chainable([minimal]))

		await cleanupPreview('prev-1')
		expect(mockDockerStop).not.toHaveBeenCalled()
	})
})

describe('cleanupPrPreviews', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetDb()
		mockDockerStop.mockResolvedValue(undefined)
		mockCreateCaddyClient.mockReturnValue({ removeRoute: vi.fn().mockResolvedValue(undefined) })
	})

	it('returns 0 when no active or building previews', async () => {
		mockDb.select.mockImplementation(() => chainable([]))
		const count = await cleanupPrPreviews('proj-1', 5)
		expect(count).toBe(0)
	})

	it('cleans active previews and marks building ones as cleaned', async () => {
		const active = [{ id: 'a1', containerName: null, domain: null, deploymentId: null, status: 'active', port: 4001, projectId: 'proj-1', prNumber: 5 }]
		const building = [{ id: 'b1' }]

		mockDb.select
			/* active previews query */
			.mockImplementationOnce(() => chainable(active))
			/* inside cleanupPreview → select preview rows */
			.mockImplementationOnce(() => chainable([active[0]]))
			/* building previews query */
			.mockImplementationOnce(() => chainable(building))

		const count = await cleanupPrPreviews('proj-1', 5)
		expect(count).toBe(2)
		expect(mockDb.update).toHaveBeenCalled()
	})
})

describe('enforcePreviewLimit', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetDb()
		mockDockerStop.mockResolvedValue(undefined)
		mockCreateCaddyClient.mockReturnValue({ removeRoute: vi.fn().mockResolvedValue(undefined) })
	})

	it('does nothing when below the limit', async () => {
		mockDb.select.mockImplementation(() => chainable([{ id: 'p1' }]))
		await enforcePreviewLimit('proj-1', 3)
		/* only the initial select — no updates for cleanup */
		expect(mockDb.update).not.toHaveBeenCalled()
	})

	it('removes oldest previews when at limit', async () => {
		const existing = [
			{ id: 'p1', containerName: null, domain: null, deploymentId: null, status: 'active', port: 4001, projectId: 'proj-1', prNumber: 1 },
			{ id: 'p2', containerName: null, domain: null, deploymentId: null, status: 'active', port: 4002, projectId: 'proj-1', prNumber: 2 },
			{ id: 'p3', containerName: null, domain: null, deploymentId: null, status: 'active', port: 4003, projectId: 'proj-1', prNumber: 3 }
		]
		/* enforcePreviewLimit → select active */
		mockDb.select
			.mockImplementationOnce(() => chainable(existing))
			/* cleanupPreview for p1 → select */
			.mockImplementationOnce(() => chainable([existing[0]]))

		await enforcePreviewLimit('proj-1', 3)
		expect(mockDb.update).toHaveBeenCalled()
	})
})
