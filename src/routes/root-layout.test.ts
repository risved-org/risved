import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUpdateChecker = vi.fn()

vi.mock('$lib/server/update', () => ({
	getUpdateChecker: mockGetUpdateChecker
}))

import { load } from './+layout.server'

function makeEvent(user: unknown) {
	return { locals: { user } } as Parameters<typeof load>[0]
}

describe('root layout load', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns null updateAvailable when user is not logged in', async () => {
		const result = await load(makeEvent(null))
		expect(result.updateAvailable).toBeNull()
	})

	it('does not call getUpdateChecker when user is absent', async () => {
		await load(makeEvent(null))
		expect(mockGetUpdateChecker).not.toHaveBeenCalled()
	})

	it('returns update versions when an update is available', async () => {
		mockGetUpdateChecker.mockReturnValue({
			getCachedUpdateInfo: vi.fn().mockResolvedValue({
				updateAvailable: true,
				currentVersion: '1.0.0',
				latestVersion: '1.1.0'
			})
		})

		const result = await load(makeEvent({ id: 'u-1', email: 'admin@example.com' }))
		expect(result.updateAvailable).toEqual({ currentVersion: '1.0.0', latestVersion: '1.1.0' })
	})

	it('returns null updateAvailable when no update exists', async () => {
		mockGetUpdateChecker.mockReturnValue({
			getCachedUpdateInfo: vi.fn().mockResolvedValue({
				updateAvailable: false,
				currentVersion: '1.2.0',
				latestVersion: '1.2.0'
			})
		})

		const result = await load(makeEvent({ id: 'u-1' }))
		expect(result.updateAvailable).toBeNull()
	})
})
