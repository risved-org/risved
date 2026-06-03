import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ────────────────────────────────────────────────── */

const {
	mockDb,
	mockRunPipeline,
	mockDockerStop,
	mockCreateCommandRunner,
	mockGetSetting,
	mockRemoveRoute,
	mockCreateCaddyClient
} = vi.hoisted(() => {
	const removeRoute = vi.fn()
	return {
		mockDb: {
			select: vi.fn(),
			insert: vi.fn(),
			update: vi.fn(),
			delete: vi.fn()
		},
		mockRunPipeline: vi.fn(),
		mockDockerStop: vi.fn(),
		mockCreateCommandRunner: vi.fn(() => ({})),
		mockGetSetting: vi.fn(),
		mockRemoveRoute: removeRoute,
		mockCreateCaddyClient: vi.fn(() => ({ removeRoute }))
	}
})

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	previewDeployments: {
		port: 'port',
		status: 'status',
		projectId: 'project_id',
		prNumber: 'pr_number',
		id: 'id',
		createdAt: 'created_at'
	},
	deployments: { id: 'id', status: 'status', finishedAt: 'finished_at' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	asc: vi.fn((a: unknown) => ({ asc: a }))
}))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/pipeline', () => ({ runPipeline: mockRunPipeline }))
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: mockCreateCommandRunner,
	dockerStop: mockDockerStop
}))
vi.mock('$lib/server/caddy', () => ({
	createCaddyClient: mockCreateCaddyClient,
	CaddyClient: vi.fn()
}))

import {
	allocatePreviewPort,
	createPreview,
	cleanupPreview,
	cleanupPrPreviews,
	enforcePreviewLimit,
	listPreviews
} from './index'

/* ── Helpers ─────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const whereResult = Object.assign(Promise.resolve(rows), {
		limit: vi.fn().mockResolvedValue(rows),
		orderBy: vi.fn().mockResolvedValue(rows)
	})
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue(whereResult)
		})
	}
}

function makeInsertChain(returning: unknown[]) {
	return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returning) }) }
}

function makeUpdateChain() {
	return {
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	}
}

const PROJECT = {
	id: 'proj-1',
	slug: 'myapp',
	repoUrl: 'https://github.com/alice/myapp.git',
	gitConnectionId: 'conn-1',
	previewLimit: 3,
	frameworkId: null,
	tier: null,
	buildCommand: null,
	startCommand: null,
	releaseCommand: null
}

beforeEach(() => {
	vi.clearAllMocks()
	mockRunPipeline.mockReturnValue(new Promise(() => {}))
})

/* ── allocatePreviewPort ─────────────────────────────────────────── */

describe('allocatePreviewPort', () => {
	it('returns 4001 when no ports are used', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([]))
		expect(await allocatePreviewPort()).toBe(4001)
	})

	it('skips used ports and returns first available', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ port: 4001 }, { port: 4002 }]))
		expect(await allocatePreviewPort()).toBe(4003)
	})

	it('throws when all ports are exhausted', async () => {
		const ports = Array.from({ length: 999 }, (_, i) => ({ port: 4001 + i }))
		mockDb.select.mockReturnValue(makeSelectChain(ports))
		await expect(allocatePreviewPort()).rejects.toThrow('No available preview ports')
	})
})

/* ── createPreview ───────────────────────────────────────────────── */

describe('createPreview', () => {
	it('returns error when hostname is not configured', async () => {
		mockGetSetting.mockResolvedValue(null)
		const result = await createPreview(PROJECT, 1, 'feat', 'branch', null)
		expect(result).toMatchObject({ success: false, error: 'No hostname configured' })
	})

	it('creates a new preview when none exists', async () => {
		mockGetSetting.mockResolvedValue('example.com')
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([]))
			.mockReturnValueOnce(makeSelectChain([]))
			.mockReturnValueOnce(makeSelectChain([]))
		mockDb.insert.mockReturnValue(makeInsertChain([{ id: 'prev-1' }]))
		mockRunPipeline.mockReturnValue(new Promise(() => {}))

		const result = await createPreview(PROJECT, 42, 'fix bug', 'fix-branch', 'abc123')

		expect(result).toMatchObject({ success: true, domain: 'pr-42.myapp.example.com' })
		expect(mockDb.insert).toHaveBeenCalled()
	})

	it('updates existing preview instead of creating new', async () => {
		mockGetSetting.mockResolvedValue('example.com')
		const existing = { id: 'prev-existing', port: 4005 }
		mockDb.select.mockReturnValueOnce(makeSelectChain([existing]))
		mockDb.update.mockReturnValue(makeUpdateChain())
		mockRunPipeline.mockReturnValue(new Promise(() => {}))

		const result = await createPreview(PROJECT, 42, 'update', 'feat', null)

		expect(result).toMatchObject({ success: true, previewId: 'prev-existing', port: 4005 })
		expect(mockDb.update).toHaveBeenCalled()
		expect(mockDb.insert).not.toHaveBeenCalled()
	})
})

/* ── cleanupPreview ──────────────────────────────────────────────── */

describe('cleanupPreview', () => {
	it('does nothing when preview not found', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([]))
		await cleanupPreview('nonexistent')
		expect(mockDockerStop).not.toHaveBeenCalled()
	})

	it('stops container, removes caddy route, marks as cleaned', async () => {
		const preview = {
			id: 'prev-1',
			containerName: 'myapp-pr-1',
			domain: 'pr-1.myapp.example.com',
			deploymentId: 'dep-1'
		}
		mockDb.select.mockReturnValue(makeSelectChain([preview]))
		mockDockerStop.mockResolvedValue(undefined)
		mockRemoveRoute.mockResolvedValue(undefined)
		mockDb.update.mockReturnValue(makeUpdateChain())

		await cleanupPreview('prev-1')

		expect(mockDockerStop).toHaveBeenCalledWith(expect.anything(), 'myapp-pr-1', 10)
		expect(mockRemoveRoute).toHaveBeenCalledWith('pr-1.myapp.example.com')
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('handles missing containerName and domain gracefully', async () => {
		const preview = { id: 'prev-1', containerName: null, domain: null, deploymentId: null }
		mockDb.select.mockReturnValue(makeSelectChain([preview]))
		mockDb.update.mockReturnValue(makeUpdateChain())

		await cleanupPreview('prev-1')

		expect(mockDockerStop).not.toHaveBeenCalled()
		expect(mockRemoveRoute).not.toHaveBeenCalled()
	})
})

/* ── cleanupPrPreviews ───────────────────────────────────────────── */

describe('cleanupPrPreviews', () => {
	it('returns 0 when no previews exist', async () => {
		mockDb.select
			.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
			.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
		const count = await cleanupPrPreviews('proj-1', 1)
		expect(count).toBe(0)
	})

	it('cleans active and building previews', async () => {
		const activePrev = { id: 'a1', containerName: null, domain: null, deploymentId: null }
		const buildingPrev = { id: 'b1' }

		mockDb.select
			.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([activePrev]) }) })
			.mockReturnValueOnce(makeSelectChain([activePrev]))
			.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([buildingPrev]) }) })

		mockDb.update.mockReturnValue(makeUpdateChain())

		const count = await cleanupPrPreviews('proj-1', 1)
		expect(count).toBe(2)
	})
})

/* ── enforcePreviewLimit ─────────────────────────────────────────── */

describe('enforcePreviewLimit', () => {
	it('does nothing when under the limit', async () => {
		const active = [{ id: 'p1' }, { id: 'p2' }]
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockResolvedValue(active)
				})
			})
		})
		await enforcePreviewLimit('proj-1', 3)
		expect(mockDb.update).not.toHaveBeenCalled()
	})
})

/* ── listPreviews ────────────────────────────────────────────────── */

describe('listPreviews', () => {
	it('returns active previews ordered by createdAt', async () => {
		const previews = [{ id: 'p1' }, { id: 'p2' }]
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockResolvedValue(previews)
				})
			})
		})
		const result = await listPreviews('proj-1')
		expect(result).toEqual(previews)
	})
})
