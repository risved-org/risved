import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const { mockExecFile } = vi.hoisted(() => ({
	mockExecFile: vi.fn()
}))

vi.mock('node:child_process', () => ({
	execFile: mockExecFile
}))

vi.mock('node:util', () => ({
	promisify: (fn: unknown) => fn
}))

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), delete: vi.fn() }
}))

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id', createdAt: 'created_at' },
	buildLogs: { deploymentId: 'deployment_id' },
	cronRuns: { startedAt: 'started_at' }
}))

vi.mock('drizzle-orm', () => ({
	lt: vi.fn((_col, val) => ({ op: 'lt', val })),
	inArray: vi.fn((_col, vals) => ({ op: 'inArray', vals }))
}))

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))

import { CleanupManager } from './index'

/* ── Tests: getDockerDiskUsage happy path ─────────────────────────── */

describe('CleanupManager.getDockerDiskUsage (docker available)', () => {
	let manager: CleanupManager

	beforeEach(() => {
		vi.clearAllMocks()
		manager = new CleanupManager()
	})

	it('parses image, container, volume and build-cache lines', async () => {
		const lines = [
			JSON.stringify({ Type: 'Images', TotalCount: '5', Size: '1.50GB' }),
			JSON.stringify({ Type: 'Containers', TotalCount: '3', Size: '200MB' }),
			JSON.stringify({ Type: 'Local Volumes', TotalCount: '2', Size: '500MB' }),
			JSON.stringify({ Type: 'Build Cache', TotalCount: '0', Size: '250MB' })
		].join('\n')

		mockExecFile.mockResolvedValue({ stdout: lines })

		const usage = await manager.getDockerDiskUsage()

		expect(usage.images).toMatchObject({ count: 5, sizeFormatted: '1.50GB' })
		expect(usage.containers).toMatchObject({ count: 3, sizeFormatted: '200MB' })
		expect(usage.volumes).toMatchObject({ count: 2, sizeFormatted: '500MB' })
		expect(usage.buildCache).toMatchObject({ sizeFormatted: '250MB' })
		expect(usage.totalFormatted).not.toBe('0 B')
	})

	it('returns zeroed usage when docker output is empty', async () => {
		mockExecFile.mockResolvedValue({ stdout: '' })

		const usage = await manager.getDockerDiskUsage()

		expect(usage.images.count).toBe(0)
		expect(usage.totalFormatted).toBe('0B')
	})

	it('falls back to zeroed usage when any line is invalid JSON', async () => {
		/* JSON.parse throws inside the for-loop, outer catch returns zeros */
		mockExecFile.mockResolvedValue({ stdout: 'not-valid-json\n' })

		const usage = await manager.getDockerDiskUsage()

		expect(usage.images.count).toBe(0)
		expect(usage.totalFormatted).toBe('0 B')
	})
})

/* ── Tests: dockerPrune happy path ────────────────────────────────── */

describe('CleanupManager.dockerPrune (docker available)', () => {
	let manager: CleanupManager

	beforeEach(() => {
		vi.clearAllMocks()
		manager = new CleanupManager()
	})

	it('parses reclaimed space for images prune', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Total reclaimed space: 1.23GB\n' })

		const result = await manager.dockerPrune('images')

		expect(result.type).toBe('images')
		expect(result.spaceReclaimed).toBe('1.23GB')
	})

	it('parses reclaimed space for containers prune', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Total reclaimed space: 450MB\n' })

		const result = await manager.dockerPrune('containers')

		expect(result.type).toBe('containers')
		expect(result.spaceReclaimed).toBe('450MB')
	})

	it('parses reclaimed space for volumes prune', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Total reclaimed space: 800MB\n' })

		const result = await manager.dockerPrune('volumes')

		expect(result.spaceReclaimed).toBe('800MB')
	})

	it('parses reclaimed space for buildcache prune', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Total reclaimed space: 2.00GB\n' })

		const result = await manager.dockerPrune('buildcache')

		expect(result.spaceReclaimed).toBe('2.00GB')
	})

	it('parses reclaimed space for all prune', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Total reclaimed space: 3.50GB\n' })

		const result = await manager.dockerPrune('all')

		expect(result.type).toBe('all')
		expect(result.spaceReclaimed).toBe('3.50GB')
	})

	it('returns 0B when docker output has no reclaimed space line', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Deleted: abc123\n' })

		const result = await manager.dockerPrune('images')

		expect(result.spaceReclaimed).toBe('0B')
	})
})
