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
	projects: { id: 'id' },
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

import { db } from '$lib/server/db'
import { CleanupManager } from './index'

const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }

/** Make the projects query resolve to the given project ids. */
function setupProjects(ids: string[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockResolvedValue(ids.map((id) => ({ id })))
	})
}

/** Route docker calls by subcommand; records every call in `calls`. */
function setupDocker(opts: {
	dangling?: string[]
	sizes?: Record<string, string>
	systemPrune?: string
	failRm?: string[]
}) {
	const calls: string[][] = []
	mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
		calls.push(args)
		if (args[0] === 'volume' && args[1] === 'ls') {
			return { stdout: (opts.dangling ?? []).join('\n') + '\n' }
		}
		if (args[0] === 'volume' && args[1] === 'rm') {
			if (opts.failRm?.includes(args[2])) throw new Error('volume is in use')
			return { stdout: args[2] + '\n' }
		}
		if (args[0] === 'system' && args[1] === 'df') {
			const Volumes = Object.entries(opts.sizes ?? {}).map(([Name, Size]) => ({ Name, Size }))
			return { stdout: JSON.stringify({ Volumes }) }
		}
		if (args[0] === 'system' && args[1] === 'prune') {
			return { stdout: opts.systemPrune ?? '' }
		}
		return { stdout: '' }
	})
	return calls
}

const removed = (calls: string[][]) =>
	calls.filter((args) => args[0] === 'volume' && args[1] === 'rm').map((args) => args[2])

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

	it('sums the size of removed volumes for volumes prune', async () => {
		setupProjects([])
		setupDocker({ dangling: ['abc123', 'old_pgdata'], sizes: { abc123: '300MB', old_pgdata: '500MB' } })

		const result = await manager.dockerPrune('volumes')

		expect(result.spaceReclaimed).toBe('800MB')
	})

	it('parses reclaimed space for buildcache prune', async () => {
		mockExecFile.mockResolvedValue({ stdout: 'Total reclaimed space: 2.00GB\n' })

		const result = await manager.dockerPrune('buildcache')

		expect(result.spaceReclaimed).toBe('2.00GB')
	})

	it('adds removed volumes to the reclaimed space for all prune', async () => {
		setupProjects([])
		setupDocker({
			dangling: ['abc123'],
			sizes: { abc123: '500MB' },
			systemPrune: 'Total reclaimed space: 3.00GB\n'
		})

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

/* ── Tests: project volumes survive a prune ───────────────────────── */

describe('CleanupManager.dockerPrune (project volume protection)', () => {
	let manager: CleanupManager

	beforeEach(() => {
		vi.clearAllMocks()
		manager = new CleanupManager()
	})

	it.each(['volumes', 'all'] as const)(
		'keeps data and postgres volumes of existing projects on %s prune',
		async (type) => {
			setupProjects(['proj1'])
			const calls = setupDocker({
				dangling: ['risved-proj1-data', 'risved-proj1-postgres', 'abc123', 'risved-gone-data']
			})

			await manager.dockerPrune(type)

			expect(removed(calls)).toEqual(['abc123', 'risved-gone-data'])
		}
	)

	it('never uses a blanket volume prune', async () => {
		setupProjects(['proj1'])
		const calls = setupDocker({ dangling: ['abc123'] })

		await manager.dockerPrune('volumes')
		await manager.dockerPrune('all')

		expect(calls.some((args) => args[0] === 'volume' && args[1] === 'prune')).toBe(false)
		expect(calls.some((args) => args.includes('--volumes'))).toBe(false)
		expect(calls.some((args) => args[1] === 'rm' && args.includes('-f'))).toBe(false)
	})

	it.each(['volumes', 'all'] as const)(
		'prunes nothing on %s prune when the projects lookup fails',
		async (type) => {
			mockDb.select.mockReturnValue({
				from: vi.fn().mockRejectedValue(new Error('db unavailable'))
			})
			const calls = setupDocker({ dangling: ['risved-proj1-data', 'abc123'] })

			const result = await manager.dockerPrune(type)

			expect(result.spaceReclaimed).toBe('0B')
			expect(calls).toEqual([])
		}
	)

	it('skips volumes that fail to remove and counts only removed ones', async () => {
		setupProjects([])
		const calls = setupDocker({
			dangling: ['busy', 'free'],
			sizes: { busy: '1.00GB', free: '200MB' },
			failRm: ['busy']
		})

		const result = await manager.dockerPrune('volumes')

		expect(removed(calls)).toEqual(['busy', 'free'])
		expect(result.spaceReclaimed).toBe('200MB')
	})

	it('does not query sizes or remove anything when only project volumes are unused', async () => {
		setupProjects(['proj1'])
		const calls = setupDocker({ dangling: ['risved-proj1-data', 'risved-proj1-postgres'] })

		const result = await manager.dockerPrune('volumes')

		expect(removed(calls)).toEqual([])
		expect(calls.some((args) => args[0] === 'system')).toBe(false)
		expect(result.spaceReclaimed).toBe('0B')
	})
})
