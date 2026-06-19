import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUpdateChecker = vi.fn()
vi.mock('$lib/server/update', () => ({
	getUpdateChecker: mockGetUpdateChecker
}))

vi.mock('$app/environment', () => ({
	building: false
}))

import { load } from './+layout.server'

function makeLocals(user?: object) {
	return { locals: { user: user ?? null } } as Parameters<typeof load>[0]
}

beforeEach(() => vi.clearAllMocks())

describe('root layout load', () => {
	it('returns null updateAvailable when no user', async () => {
		const result = await load(makeLocals())
		expect(result).toEqual({ updateAvailable: null })
		expect(mockGetUpdateChecker).not.toHaveBeenCalled()
	})

	it('returns null updateAvailable when no update available', async () => {
		mockGetUpdateChecker.mockReturnValue({
			getCachedUpdateInfo: vi.fn().mockResolvedValue({
				updateAvailable: false,
				currentVersion: '1.0.0',
				latestVersion: null
			})
		})

		const result = await load(makeLocals({ id: 'u1' }))
		expect(result).toEqual({ updateAvailable: null })
	})

	it('returns version info when update is available', async () => {
		mockGetUpdateChecker.mockReturnValue({
			getCachedUpdateInfo: vi.fn().mockResolvedValue({
				updateAvailable: true,
				currentVersion: '1.0.0',
				latestVersion: '1.1.0'
			})
		})

		const result = await load(makeLocals({ id: 'u1' }))
		expect(result).toEqual({
			updateAvailable: { currentVersion: '1.0.0', latestVersion: '1.1.0' }
		})
	})
})
