import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

let mockPackageVersion = '0.2.0'

vi.mock('node:fs', () => ({
	readFileSync: vi.fn((_path: string) => JSON.stringify({ version: mockPackageVersion }))
}))

vi.mock('node:child_process', () => ({
	execFile: vi.fn(),
	execSync: vi.fn().mockReturnValue('2000000\n')
}))

vi.mock('node:util', () => ({
	promisify: vi.fn((fn: unknown) => fn)
}))

vi.mock('node:fs/promises', () => ({
	writeFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('node:path', () => ({
	resolve: (...args: string[]) => args.join('/')
}))

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), delete: vi.fn() }
}))

vi.mock('$lib/server/db/schema', () => ({
	deployments: { status: 'status' }
}))

vi.mock('drizzle-orm', () => ({
	inArray: vi.fn((_col, vals) => ({ op: 'inArray', vals }))
}))

const mockSettings = new Map<string, string>()
vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn((key: string) => Promise.resolve(mockSettings.get(key) ?? null)),
	setSetting: vi.fn((key: string, value: string) => {
		mockSettings.set(key, value)
		return Promise.resolve()
	})
}))

import { readFileSync } from 'node:fs'
import { db } from '$lib/server/db'
import { UpdateChecker, compareSemver } from './index'

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('compareSemver', () => {
	it('returns 0 for equal versions', () => {
		expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
		expect(compareSemver('0.2.1', '0.2.1')).toBe(0)
	})

	it('returns 1 when a > b', () => {
		expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
		expect(compareSemver('0.3.0', '0.2.1')).toBe(1)
		expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
	})

	it('returns -1 when a < b', () => {
		expect(compareSemver('0.2.1', '0.3.0')).toBe(-1)
		expect(compareSemver('0.0.1', '0.0.2')).toBe(-1)
		expect(compareSemver('0.9.9', '1.0.0')).toBe(-1)
	})

	it('handles v prefix', () => {
		expect(compareSemver('v1.0.0', '1.0.0')).toBe(0)
		expect(compareSemver('v0.3.0', 'v0.2.1')).toBe(1)
	})
})

describe('UpdateChecker', () => {
	let checker: UpdateChecker

	beforeEach(() => {
		vi.clearAllMocks()
		mockSettings.clear()
		mockPackageVersion = '0.2.0'
		vi.mocked(readFileSync).mockImplementation(() => JSON.stringify({ version: mockPackageVersion }))
		checker = new UpdateChecker({
			versionUrl: 'https://example.com/version.json',
			installDir: '/tmp/test-risved'
		})
	})

	afterEach(() => {
		checker.stop()
	})

	it('starts and stops timer', () => {
		expect(checker.isRunning()).toBe(false)
		checker.start()
		expect(checker.isRunning()).toBe(true)
		checker.stop()
		expect(checker.isRunning()).toBe(false)
	})

	it('does not start twice', () => {
		checker.start()
		checker.start()
		expect(checker.isRunning()).toBe(true)
		checker.stop()
	})

	it('returns version from package.json', async () => {
		mockPackageVersion = '1.2.3'
		const version = await checker.getCurrentVersion()
		expect(version).toBe('1.2.3')
	})

	it('returns default version when package.json read fails', async () => {
		vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
		const version = await checker.getCurrentVersion()
		expect(version).toBe('0.0.1')
	})

	it('getCachedUpdateInfo returns no update when no data stored', async () => {
		const info = await checker.getCachedUpdateInfo()
		expect(info.currentVersion).toBe('0.2.0')
		expect(info.updateAvailable).toBe(false)
		expect(info.latestVersion).toBeNull()
	})

	it('getCachedUpdateInfo returns update available', async () => {
		mockSettings.set('update_available_version', '0.3.0')
		mockSettings.set('update_release_notes', 'Bug fixes')

		const info = await checker.getCachedUpdateInfo()
		expect(info.currentVersion).toBe('0.2.0')
		expect(info.updateAvailable).toBe(true)
		expect(info.latestVersion).toBe('0.3.0')
		expect(info.releaseNotes).toBe('Bug fixes')
	})

	it('getCachedUpdateInfo returns no update when versions match', async () => {
		mockPackageVersion = '0.3.0'
		mockSettings.set('update_available_version', '0.3.0')

		const info = await checker.getCachedUpdateInfo()
		expect(info.updateAvailable).toBe(false)
	})

	it('preflightCheck passes with no active builds and enough disk', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		})

		const result = await checker.preflightCheck()
		expect(result.ok).toBe(true)
	})

	it('preflightCheck fails with active builds', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ id: 'deploy-1', status: 'building' }])
			})
		})

		const result = await checker.preflightCheck()
		expect(result.ok).toBe(false)
		expect(result.reason).toContain('active builds')
	})

	it('preflightCheck fails when version is too old', async () => {
		mockPackageVersion = '0.0.1'
		mockSettings.set('update_min_version', '0.1.0')

		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		})

		const result = await checker.preflightCheck()
		expect(result.ok).toBe(false)
		expect(result.reason).toContain('too old')
	})

	it('isUpdating returns false initially', () => {
		expect(checker.isUpdating()).toBe(false)
	})

	it('fetchVersionManifest returns null on network error', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'))
		const result = await checker.fetchVersionManifest()
		expect(result).toBeNull()
		vi.restoreAllMocks()
	})

	it('checkForUpdates stores result in settings', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({
				version: '0.3.0',
				releaseNotes: 'New features',
				minVersion: '0.1.0'
			}), { status: 200 })
		)

		const info = await checker.checkForUpdates()
		expect(info.updateAvailable).toBe(true)
		expect(info.latestVersion).toBe('0.3.0')
		expect(mockSettings.get('update_available_version')).toBe('0.3.0')
		expect(mockSettings.get('last_update_check')).toBeTruthy()

		vi.restoreAllMocks()
	})

	it('checkForUpdates handles no update', async () => {
		mockPackageVersion = '0.3.0'
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({
				version: '0.3.0',
				releaseNotes: '',
				minVersion: '0.1.0'
			}), { status: 200 })
		)

		const info = await checker.checkForUpdates()
		expect(info.updateAvailable).toBe(false)
		expect(mockSettings.get('update_available_version')).toBe('')

		vi.restoreAllMocks()
	})

	it('checkForUpdates handles fetch failure', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'))

		const info = await checker.checkForUpdates()
		expect(info.updateAvailable).toBe(false)
		expect(info.error).toContain('Could not reach')

		vi.restoreAllMocks()
	})
})

describe('UpdateChecker.pullUpdate', () => {
	let checker: UpdateChecker

	beforeEach(() => {
		vi.clearAllMocks()
		mockPackageVersion = '0.2.0'
		checker = new UpdateChecker({ versionUrl: 'https://example.com/version.json', installDir: '/tmp/test' })
	})

	afterEach(() => checker.stop())

	it('calls docker pull with the correct image tag', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>
		mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' })

		await checker.pullUpdate('0.3.0')

		expect(mockExec).toHaveBeenCalledWith(
			'docker',
			['pull', 'ghcr.io/risved-org/risved:0.3.0'],
			expect.objectContaining({ timeout: 300_000 })
		)
	})

	it('strips v prefix from version tag', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>
		mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' })

		await checker.pullUpdate('v0.3.0')

		expect(mockExec).toHaveBeenCalledWith(
			'docker',
			['pull', 'ghcr.io/risved-org/risved:0.3.0'],
			expect.anything()
		)
	})

	it('propagates docker pull errors', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>
		mockExec.mockRejectedValueOnce(new Error('docker: not found'))

		await expect(checker.pullUpdate('0.3.0')).rejects.toThrow('docker: not found')
	})
})

describe('UpdateChecker.restartControlPlane', () => {
	let checker: UpdateChecker

	beforeEach(() => {
		vi.clearAllMocks()
		mockPackageVersion = '0.2.0'
		checker = new UpdateChecker({ versionUrl: 'https://example.com/version.json', installDir: '/tmp/test' })
	})

	afterEach(() => checker.stop())

	it('calls docker inspect and spawns helper container', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>

		const fakeInspect = JSON.stringify([{
			Config: { Env: ['FOO=bar'] },
			HostConfig: { PortBindings: {}, Binds: ['/opt/risved/data:/app/data'], Mounts: [] },
			NetworkSettings: { Networks: { risved: {} } }
		}])
		mockExec
			.mockResolvedValueOnce({ stdout: fakeInspect, stderr: '' })
			.mockResolvedValueOnce({ stdout: '', stderr: '' })

		await checker.restartControlPlane('0.3.0')

		expect(mockExec).toHaveBeenCalledTimes(2)
		expect(mockExec).toHaveBeenNthCalledWith(1, 'docker', ['inspect', 'risved-control'])
		expect(mockExec).toHaveBeenNthCalledWith(
			2, 'docker',
			expect.arrayContaining(['run', '-d', '--rm']),
			expect.any(Object)
		)
	})

	it('stores target version in settings before restart', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>

		const fakeInspect = JSON.stringify([{
			Config: { Env: [] },
			HostConfig: { PortBindings: {}, Binds: ['/data:/app/data'], Mounts: [] },
			NetworkSettings: { Networks: { risved: {} } }
		}])
		mockExec
			.mockResolvedValueOnce({ stdout: fakeInspect, stderr: '' })
			.mockResolvedValueOnce({ stdout: '', stderr: '' })

		const mockSettings = new Map<string, string>()
		const { setSetting } = await import('$lib/server/settings')
		vi.mocked(setSetting).mockImplementation((k: string, v: string) => {
			mockSettings.set(k, v)
			return Promise.resolve()
		})

		await checker.restartControlPlane('0.3.0')
		expect(mockSettings.get('risved_version')).toBe('0.3.0')
	})
})

describe('UpdateChecker.performUpdate', () => {
	let checker: UpdateChecker

	beforeEach(() => {
		vi.clearAllMocks()
		mockPackageVersion = '0.2.0'
		checker = new UpdateChecker({ versionUrl: 'https://example.com/version.json', installDir: '/tmp/test' })
	})

	afterEach(() => checker.stop())

	it('throws when update already in progress', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>
		/* Make pullUpdate hang */
		mockExec.mockReturnValue(new Promise(() => { /* never resolves */ }))

		const firstUpdate = checker.performUpdate('0.3.0')
		await expect(checker.performUpdate('0.3.0')).rejects.toThrow('already in progress')
		/* Clean up the hanging promise */
		checker.stop()
		firstUpdate.catch(() => {})
	})

	it('isUpdating returns true once update begins', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>
		mockExec.mockRejectedValueOnce(new Error('pull failed'))

		expect(checker.isUpdating()).toBe(false)
		const updatePromise = checker.performUpdate('0.3.0')
		/* isUpdating is set synchronously before the first await */
		expect(checker.isUpdating()).toBe(true)
		await updatePromise.catch(() => {})
		/* After failure, updating is cleared */
		expect(checker.isUpdating()).toBe(false)
	})

	it('clears updating flag and stores error on failure', async () => {
		const { execFile } = await import('node:child_process')
		const mockExec = vi.mocked(execFile) as ReturnType<typeof vi.fn>
		mockExec.mockRejectedValueOnce(new Error('pull failed'))

		await expect(checker.performUpdate('0.3.0')).rejects.toThrow('pull failed')
		expect(checker.isUpdating()).toBe(false)
	})
})

describe('getUpdateChecker singleton', () => {
	it('returns the same instance on multiple calls', async () => {
		const { getUpdateChecker } = await import('./index')
		const a = getUpdateChecker()
		const b = getUpdateChecker()
		expect(a).toBe(b)
		a.stop()
	})
})
