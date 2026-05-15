import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── hoisted mock primitives ──────────────────────────────────────── */

const mockSelect = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockGetSetting = vi.hoisted(() => vi.fn())
const mockRunPipeline = vi.hoisted(() => vi.fn())
const mockDockerStop = vi.hoisted(() => vi.fn())
const mockRemoveRoute = vi.hoisted(() => vi.fn())

vi.mock('$lib/server/db', () => ({
	db: { select: mockSelect, insert: mockInsert, update: mockUpdate }
}))

vi.mock('$lib/server/db/schema', () => ({
	previewDeployments: 'preview_deps_table',
	deployments: 'deployments_table'
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	asc: vi.fn(() => 'asc_fn')
}))

vi.mock('$lib/server/settings', () => ({
	getSetting: mockGetSetting
}))

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: mockRunPipeline
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({})),
	dockerStop: mockDockerStop
}))

vi.mock('$lib/server/caddy', () => ({
	createCaddyClient: vi.fn(() => ({ removeRoute: mockRemoveRoute }))
}))

import {
	buildPreviewDomain,
	allocatePreviewPort,
	createPreview,
	cleanupPreview,
	enforcePreviewLimit,
	listPreviews
} from './index'

/* ── chain builder ────────────────────────────────────────────────── */

/**
 * Build a flexible query chain where every terminal call (where, limit, orderBy)
 * resolves to `rows`. One select() call consumes one entry.
 */
function selectReturning(rows: unknown[]) {
	const promise = Promise.resolve(rows)
	const limit = vi.fn().mockReturnValue(promise)
	const orderBy = vi.fn().mockReturnValue(promise)
	const where = vi.fn().mockReturnValue({ limit, orderBy, then: promise.then.bind(promise) })
	const from = vi.fn(() => ({ where, orderBy, limit }))
	mockSelect.mockReturnValueOnce({ from })
}

function setupUpdateChain() {
	const whereMock = vi.fn().mockReturnValue(Promise.resolve())
	const catchMock = vi.fn().mockReturnValue(Promise.resolve())
	const whereMockWithCatch = vi.fn().mockReturnValue({ catch: catchMock })
	const setMock = vi.fn(() => ({
		where: whereMock,
		catch: catchMock
	}))
	mockUpdate.mockReturnValue({ set: setMock })
	void whereMockWithCatch
	return { setMock, whereMock }
}

function setupInsertChain(returnedRows: unknown[] = [{ id: 'pv-new' }]) {
	const returningMock = vi.fn().mockResolvedValue(returnedRows)
	const valuesMock = vi.fn(() => ({ returning: returningMock }))
	mockInsert.mockReturnValue({ values: valuesMock })
}

const sampleProject = {
	id: 'proj-1',
	slug: 'my-app',
	repoUrl: 'https://github.com/test/repo',
	branch: 'main',
	gitConnectionId: null,
	port: 3000,
	frameworkId: null,
	tier: null,
	buildCommand: null,
	startCommand: null,
	releaseCommand: null,
	previewLimit: 3
}

/* ── buildPreviewDomain ───────────────────────────────────────────── */

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

/* ── allocatePreviewPort ──────────────────────────────────────────── */

describe('allocatePreviewPort', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 4001 when no ports are in use', async () => {
		selectReturning([])
		expect(await allocatePreviewPort()).toBe(4001)
	})

	it('returns next port after consecutive used ones', async () => {
		selectReturning([{ port: 4001 }, { port: 4002 }, { port: 4003 }])
		expect(await allocatePreviewPort()).toBe(4004)
	})

	it('skips null port entries', async () => {
		selectReturning([{ port: null }, { port: 4001 }])
		expect(await allocatePreviewPort()).toBe(4002)
	})

	it('throws when all ports exhausted', async () => {
		const all = Array.from({ length: 999 }, (_, i) => ({ port: 4001 + i }))
		selectReturning(all)
		await expect(allocatePreviewPort()).rejects.toThrow('No available preview ports')
	})
})

/* ── listPreviews ─────────────────────────────────────────────────── */

describe('listPreviews', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns active previews for a project', async () => {
		const rows = [{ id: 'pv1', projectId: 'proj-1', status: 'active' }]
		selectReturning(rows)
		expect(await listPreviews('proj-1')).toEqual(rows)
	})

	it('returns empty array when no active previews', async () => {
		selectReturning([])
		expect(await listPreviews('proj-1')).toEqual([])
	})
})

/* ── createPreview ────────────────────────────────────────────────── */

describe('createPreview', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns error when hostname not configured', async () => {
		mockGetSetting.mockResolvedValue(null)
		const result = await createPreview(sampleProject, 1, 'Fix bug', 'feature/fix', 'abc')
		expect(result).toMatchObject({ success: false, error: expect.stringContaining('hostname') })
	})

	it('creates a new preview and returns success', async () => {
		mockGetSetting.mockResolvedValue('risved.example.com')
		/* existing check → none */
		selectReturning([])
		/* enforcePreviewLimit → 0 active, nothing to remove */
		selectReturning([])
		/* allocatePreviewPort → no used ports */
		selectReturning([])
		setupInsertChain([{ id: 'pv-new' }])
		/* fire-and-forget pipeline update after resolve */
		mockRunPipeline.mockReturnValue(Promise.resolve({ success: true, deploymentId: 'd-1', commitSha: 'sha' }))
		setupUpdateChain()

		const result = await createPreview(sampleProject, 42, 'My PR', 'feature/x', 'sha1')
		expect(result.success).toBe(true)
		expect(result.domain).toBe('pr-42.my-app.risved.example.com')
		expect(result.previewId).toBe('pv-new')
	})

	it('reuses existing preview port and updates record', async () => {
		mockGetSetting.mockResolvedValue('risved.example.com')
		/* existing check → found */
		selectReturning([{ id: 'pv-exist', port: 4001 }])
		setupUpdateChain()
		mockRunPipeline.mockReturnValue(Promise.resolve({ success: true, deploymentId: 'd-2', commitSha: 'sha2' }))
		setupUpdateChain()

		const result = await createPreview(sampleProject, 7, 'Update', 'feat/update', 'sha2')
		expect(result.success).toBe(true)
		expect(result.previewId).toBe('pv-exist')
	})
})

/* ── cleanupPreview ───────────────────────────────────────────────── */

describe('cleanupPreview', () => {
	beforeEach(() => vi.clearAllMocks())

	it('does nothing when preview not found', async () => {
		selectReturning([])
		await cleanupPreview('pv-missing')
		expect(mockUpdate).not.toHaveBeenCalled()
	})

	it('marks preview as cleaned when no container or domain', async () => {
		selectReturning([{ id: 'pv-1', containerName: null, domain: null, deploymentId: null }])
		setupUpdateChain()
		await cleanupPreview('pv-1')
		expect(mockUpdate).toHaveBeenCalled()
	})

	it('stops container when containerName present', async () => {
		selectReturning([{ id: 'pv-1', containerName: 'my-app-pr-5', domain: null, deploymentId: null }])
		mockDockerStop.mockResolvedValue(undefined)
		setupUpdateChain()
		await cleanupPreview('pv-1')
		expect(mockDockerStop).toHaveBeenCalledWith(expect.anything(), 'my-app-pr-5', 10)
	})

	it('removes caddy route when domain present', async () => {
		selectReturning([{ id: 'pv-1', containerName: null, domain: 'pr-5.app.example.com', deploymentId: null }])
		mockRemoveRoute.mockResolvedValue(undefined)
		setupUpdateChain()
		await cleanupPreview('pv-1')
		expect(mockRemoveRoute).toHaveBeenCalledWith('pr-5.app.example.com')
	})

	it('marks deployment stopped when deploymentId present', async () => {
		selectReturning([{ id: 'pv-1', containerName: null, domain: null, deploymentId: 'd-1' }])
		setupUpdateChain()
		setupUpdateChain()
		await cleanupPreview('pv-1')
		expect(mockUpdate).toHaveBeenCalledTimes(2)
	})
})

/* ── enforcePreviewLimit ──────────────────────────────────────────── */

describe('enforcePreviewLimit', () => {
	beforeEach(() => vi.clearAllMocks())

	it('does nothing when active count is under the limit', async () => {
		selectReturning([{ id: 'pv-1' }, { id: 'pv-2' }])
		await enforcePreviewLimit('proj-1', 5)
		expect(mockUpdate).not.toHaveBeenCalled()
	})

	it('removes oldest preview when at the limit', async () => {
		/* enforcePreviewLimit fetches 3 active, limit=3 → must remove 1 */
		selectReturning([
			{ id: 'pv-old', containerName: null, domain: null, deploymentId: null },
			{ id: 'pv-2', containerName: null, domain: null, deploymentId: null },
			{ id: 'pv-3', containerName: null, domain: null, deploymentId: null }
		])
		/* cleanupPreview will call select for 'pv-old' */
		selectReturning([{ id: 'pv-old', containerName: null, domain: null, deploymentId: null }])
		setupUpdateChain()
		await enforcePreviewLimit('proj-1', 3)
		expect(mockUpdate).toHaveBeenCalled()
	})
})

/* ── preview types ────────────────────────────────────────────────── */

describe('preview types', () => {
	it('module loads successfully', async () => {
		const types = await import('./types')
		expect(types).toBeDefined()
	})
})
