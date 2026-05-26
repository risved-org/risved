import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const mockChecker = {
	checkForUpdates: vi.fn()
}

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' })
}))

vi.mock('$lib/server/update', () => ({
	getUpdateChecker: vi.fn(() => mockChecker)
}))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent() {
	return {
		request: new Request('http://localhost/', { method: 'POST' }),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/')
	}
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('POST /api/system/update/check', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns update info when update is available', async () => {
		const info = { updateAvailable: true, latestVersion: '1.2.0', currentVersion: '1.0.0' }
		mockChecker.checkForUpdates.mockResolvedValue(info)

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.updateAvailable).toBe(true)
		expect(data.latestVersion).toBe('1.2.0')
	})

	it('returns info when no update is available', async () => {
		const info = { updateAvailable: false, latestVersion: '1.0.0', currentVersion: '1.0.0' }
		mockChecker.checkForUpdates.mockResolvedValue(info)

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.updateAvailable).toBe(false)
	})
})
