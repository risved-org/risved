import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

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

	it('returns stored version from settings', async () => {
		mockSettings.set('risved_version', '1.2.3')
		const version = await checker.getCurrentVersion()
		expect(version).toBe('1.2.3')
	})

	it('returns default version when no setting exists', async () => {
		const version = await checker.getCurrentVersion()
		/* Falls back to 0.0.1 since package.json won't exist at /tmp */
		expect(version).toBe('0.0.1')
	})

	it('getCachedUpdateInfo returns no update when no data stored', async () => {
		mockSettings.set('risved_version', '0.2.0')
		const info = await checker.getCachedUpdateInfo()
		expect(info.currentVersion).toBe('0.2.0')
		expect(info.updateAvailable).toBe(false)
		expect(info.latestVersion).toBeNull()
	})

	it('getCachedUpdateInfo returns update available', async () => {
		mockSettings.set('risved_version', '0.2.0')
		mockSettings.set('update_available_version', '0.3.0')
		mockSettings.set('update_release_notes', 'Bug fixes')

		const info = await checker.getCachedUpdateInfo()
		expect(info.currentVersion).toBe('0.2.0')
		expect(info.updateAvailable).toBe(true)
		expect(info.latestVersion).toBe('0.3.0')
		expect(info.releaseNotes).toBe('Bug fixes')
	})

	it('getCachedUpdateInfo returns no update when versions match', async () => {
		mockSettings.set('risved_version', '0.3.0')
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
		mockSettings.set('risved_version', '0.0.1')
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
		mockSettings.set('risved_version', '0.2.0')
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
		mockSettings.set('risved_version', '0.3.0')
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
		mockSettings.set('risved_version', '0.2.0')
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'))

		const info = await checker.checkForUpdates()
		expect(info.updateAvailable).toBe(false)
		expect(info.error).toContain('Could not reach')

		vi.restoreAllMocks()
	})
})
