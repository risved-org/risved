import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ────────────────────────────────────────────────── */

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn()
	}
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
	deployments: { id: 'id', status: 'status', finishedAt: 'finished_at' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	asc: vi.fn((col: unknown) => ({ asc: col }))
}))
vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))
vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn()
}))
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	dockerStop: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('$lib/server/caddy', () => ({
	createCaddyClient: vi.fn().mockReturnValue({
		removeRoute: vi.fn().mockResolvedValue(undefined)
	})
}))

import {
	allocatePreviewPort,
	createPreview,
	cleanupPreview,
	cleanupPrPreviews,
	enforcePreviewLimit,
	listPreviews
} from './index'
import { getSetting } from '$lib/server/settings'
import { runPipeline } from '$lib/server/pipeline'

const mockGetSetting = vi.mocked(getSetting)
const mockRunPipeline = vi.mocked(runPipeline)

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Returns a mock db.select() chain whose terminal nodes resolve to `rows`.
 *  Supports: .where() | .where().limit() | .where().orderBy() | .from().orderBy()
 */
function selectReturning(rows: unknown[]) {
	const whereResult = Object.assign(Promise.resolve(rows), {
		limit: vi.fn().mockResolvedValue(rows),
		orderBy: vi.fn().mockResolvedValue(rows)
	})
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue(whereResult),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	}
}

function updateChain() {
	const where = vi.fn().mockResolvedValue([])
	const set = vi.fn().mockReturnValue({ where, catch: vi.fn().mockResolvedValue(undefined) })
	mockDb.update.mockReturnValue({ set })
	return { set, where }
}

const BASE_PROJECT = {
	id: 'proj-1',
	slug: 'my-app',
	repoUrl: 'https://github.com/owner/repo',
	branch: 'main',
	gitConnectionId: null,
	frameworkId: null,
	tier: null,
	previewLimit: 3,
	previewsEnabled: true,
	previewAutoDelete: true,
	buildCommand: null,
	startCommand: null,
	releaseCommand: null
}

/* ── allocatePreviewPort ─────────────────────────────────────────── */

describe('allocatePreviewPort', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 4001 when no ports are in use', async () => {
		mockDb.select.mockReturnValue(selectReturning([]))
		const port = await allocatePreviewPort()
		expect(port).toBe(4001)
	})

	it('skips used ports and returns the first free one', async () => {
		mockDb.select.mockReturnValue(selectReturning([{ port: 4001 }, { port: 4002 }]))
		const port = await allocatePreviewPort()
		expect(port).toBe(4003)
	})

	it('ignores null ports in the used set', async () => {
		mockDb.select.mockReturnValue(selectReturning([{ port: null }]))
		const port = await allocatePreviewPort()
		expect(port).toBe(4001)
	})
})

/* ── createPreview ────────────────────────────────────────────────── */

describe('createPreview', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns error when hostname not configured', async () => {
		mockGetSetting.mockResolvedValue(null)
		const result = await createPreview(BASE_PROJECT, 1, 'Fix bug', 'main', 'abc123')
		expect(result).toMatchObject({ success: false, error: 'No hostname configured' })
	})

	it('creates a new preview when none exists', async () => {
		mockGetSetting.mockResolvedValue('risved.example.com')
		/* First select: check existing preview → none */
		mockDb.select
			.mockReturnValueOnce(selectReturning([]))
			/* Second select: allocate port → none used */
			.mockReturnValueOnce(selectReturning([]))
		/* insert returning */
		const insertReturning = vi.fn().mockResolvedValue([{ id: 'prev-1' }])
		const insertValues = vi.fn().mockReturnValue({ returning: insertReturning })
		mockDb.insert.mockReturnValue({ values: insertValues })
		/* pipeline fire-and-forget */
		mockRunPipeline.mockResolvedValue({ success: true, deploymentId: 'd-1' } as never)
		/* update after pipeline */
		updateChain()

		const result = await createPreview(BASE_PROJECT, 7, 'PR title', 'feature/x', 'sha1')
		expect(result).toMatchObject({ success: true, previewId: 'prev-1', port: 4001 })
		expect(result.domain).toContain('pr-7.my-app.risved.example.com')
	})

	it('reuses an existing preview and updates it', async () => {
		mockGetSetting.mockResolvedValue('risved.example.com')
		mockDb.select.mockReturnValue(selectReturning([{ id: 'prev-old', port: 4010 }]))
		const { where } = updateChain()
		mockRunPipeline.mockResolvedValue({ success: true, deploymentId: 'd-2' } as never)

		const result = await createPreview(BASE_PROJECT, 7, 'Updated title', 'feature/x', 'sha2')
		expect(result).toMatchObject({ success: true, previewId: 'prev-old', port: 4010 })
		expect(mockDb.update).toHaveBeenCalled()
		expect(where).toHaveBeenCalled()
	})
})

/* ── cleanupPreview ───────────────────────────────────────────────── */

describe('cleanupPreview', () => {
	beforeEach(() => vi.clearAllMocks())

	it('does nothing when preview not found', async () => {
		mockDb.select.mockReturnValue(selectReturning([]))
		await cleanupPreview('missing-id')
		expect(mockDb.update).not.toHaveBeenCalled()
	})

	it('stops container, removes caddy route, and marks cleaned', async () => {
		mockDb.select.mockReturnValue(
			selectReturning([
				{
					id: 'prev-1',
					containerName: 'my-app-pr-5',
					domain: 'pr-5.my-app.risved.example.com',
					deploymentId: 'd-99'
				}
			])
		)
		const { where } = updateChain()

		await cleanupPreview('prev-1')
		expect(mockDb.update).toHaveBeenCalled()
		expect(where).toHaveBeenCalled()
	})

	it('handles preview with no containerName or domain', async () => {
		mockDb.select.mockReturnValue(
			selectReturning([{ id: 'prev-2', containerName: null, domain: null, deploymentId: null }])
		)
		updateChain()
		await cleanupPreview('prev-2')
		expect(mockDb.update).toHaveBeenCalled()
	})
})

/* ── cleanupPrPreviews ────────────────────────────────────────────── */

describe('cleanupPrPreviews', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 0 when no previews exist', async () => {
		mockDb.select.mockReturnValue(selectReturning([]))
		const count = await cleanupPrPreviews('proj-1', 3)
		expect(count).toBe(0)
	})

	it('cleans up active and building previews, returns total count', async () => {
		/* First select: active previews */
		mockDb.select
			.mockReturnValueOnce(selectReturning([{ id: 'a1', containerName: null, domain: null, deploymentId: null }]))
			/* cleanupPreview inner select */
			.mockReturnValueOnce(selectReturning([{ id: 'a1', containerName: null, domain: null, deploymentId: null }]))
			/* Second select: building previews */
			.mockReturnValueOnce(selectReturning([{ id: 'b1' }]))
		updateChain()

		const count = await cleanupPrPreviews('proj-1', 5)
		expect(count).toBe(2)
	})
})

/* ── enforcePreviewLimit ─────────────────────────────────────────── */

describe('enforcePreviewLimit', () => {
	beforeEach(() => vi.clearAllMocks())

	it('does nothing when under the limit', async () => {
		mockDb.select.mockReturnValue(selectReturning([{ id: 'p1' }, { id: 'p2' }]))
		await enforcePreviewLimit('proj-1', 3)
		expect(mockDb.update).not.toHaveBeenCalled()
	})

	it('removes oldest previews when at limit', async () => {
		/* active list: 3 previews, limit 3 → toRemove = 1 */
		mockDb.select
			.mockReturnValueOnce(
				selectReturning([{ id: 'old1' }, { id: 'old2' }, { id: 'new1' }])
			)
			/* cleanupPreview inner select for 'old1' */
			.mockReturnValueOnce(selectReturning([{ id: 'old1', containerName: null, domain: null, deploymentId: null }]))
		updateChain()

		await enforcePreviewLimit('proj-1', 3)
		expect(mockDb.update).toHaveBeenCalled()
	})
})

/* ── listPreviews ────────────────────────────────────────────────── */

describe('listPreviews', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns active previews for a project', async () => {
		const rows = [{ id: 'p1', status: 'active' }, { id: 'p2', status: 'active' }]
		mockDb.select.mockReturnValue(selectReturning(rows))
		const result = await listPreviews('proj-1')
		expect(result).toEqual(rows)
	})

	it('returns empty array when no active previews', async () => {
		mockDb.select.mockReturnValue(selectReturning([]))
		const result = await listPreviews('proj-1')
		expect(result).toEqual([])
	})
})
