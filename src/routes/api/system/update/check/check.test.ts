import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockChecker = {
	checkForUpdates: vi.fn()
}

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' })
}))

vi.mock('$lib/server/update', () => ({
	getUpdateChecker: vi.fn()
}))

import { getUpdateChecker } from '$lib/server/update'
import { POST } from './+server'

function makeEvent() {
	return {
		locals: {},
		request: new Request('http://localhost/api/system/update/check', {
			method: 'POST'
		})
	} as Parameters<typeof POST>[0]
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('POST /api/system/update/check', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getUpdateChecker).mockReturnValue(
			mockChecker as ReturnType<typeof getUpdateChecker>
		)
	})

	it('returns fresh update info when no update is available', async () => {
		mockChecker.checkForUpdates.mockResolvedValue({
			updateAvailable: false,
			currentVersion: '1.0.0'
		})

		const res = await POST(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ updateAvailable: false, currentVersion: '1.0.0' })
	})

	it('returns update info when update is available', async () => {
		mockChecker.checkForUpdates.mockResolvedValue({
			updateAvailable: true,
			currentVersion: '1.0.0',
			latestVersion: '2.0.0'
		})

		const res = await POST(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.updateAvailable).toBe(true)
		expect(body.latestVersion).toBe('2.0.0')
	})

	it('calls checkForUpdates on the checker', async () => {
		mockChecker.checkForUpdates.mockResolvedValue({ updateAvailable: false })

		await POST(makeEvent())
		expect(mockChecker.checkForUpdates).toHaveBeenCalledOnce()
	})
})
