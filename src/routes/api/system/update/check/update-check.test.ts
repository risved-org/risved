import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' })
}))

const mockChecker = {
	checkForUpdates: vi.fn()
}

vi.mock('$lib/server/update', () => ({
	getUpdateChecker: vi.fn()
}))

import { getUpdateChecker } from '$lib/server/update'
import { POST } from './+server'

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent() {
	return {
		locals: {},
		request: new Request('http://localhost/api/system/update/check', { method: 'POST' })
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

	it('returns the result of checkForUpdates', async () => {
		const info = { updateAvailable: true, latestVersion: '2.0.0', currentVersion: '1.0.0' }
		mockChecker.checkForUpdates.mockResolvedValue(info)

		const res = await POST(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual(info)
	})

	it('calls checkForUpdates exactly once per request', async () => {
		mockChecker.checkForUpdates.mockResolvedValue({ updateAvailable: false })

		await POST(makeEvent())
		expect(mockChecker.checkForUpdates).toHaveBeenCalledTimes(1)
	})
})
