import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockChecker = {
	getCachedUpdateInfo: vi.fn(),
	isUpdating: vi.fn(),
	checkForUpdates: vi.fn(),
	preflightCheck: vi.fn(),
	performUpdate: vi.fn()
}

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' })
}))

vi.mock('$lib/server/update', () => ({
	getUpdateChecker: vi.fn()
}))

import { getUpdateChecker } from '$lib/server/update'
import { GET, POST } from './+server'

function makeEvent(body?: unknown) {
	return {
		locals: {},
		request: new Request('http://localhost/api/system/update', {
			method: body ? 'POST' : 'GET',
			headers: { 'content-type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined
		})
	} as Parameters<typeof GET>[0]
}

describe('GET /api/system/update', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getUpdateChecker).mockReturnValue(
			mockChecker as ReturnType<typeof getUpdateChecker>
		)
	})

	it('returns cached update info', async () => {
		mockChecker.getCachedUpdateInfo.mockResolvedValue({ updateAvailable: false, currentVersion: '1.0.0' })
		const res = await GET(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ updateAvailable: false, currentVersion: '1.0.0' })
	})
})

describe('POST /api/system/update', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getUpdateChecker).mockReturnValue(
			mockChecker as ReturnType<typeof getUpdateChecker>
		)
	})

	it('returns 409 when an update is already in progress', async () => {
		mockChecker.isUpdating.mockReturnValue(true)
		const res = await POST(makeEvent())
		expect(res.status).toBe(409)
	})

	it('returns 400 when no update is available', async () => {
		mockChecker.isUpdating.mockReturnValue(false)
		mockChecker.checkForUpdates.mockResolvedValue({ updateAvailable: false })
		const res = await POST(makeEvent())
		expect(res.status).toBe(400)
	})

	it('returns 400 when preflight check fails', async () => {
		mockChecker.isUpdating.mockReturnValue(false)
		mockChecker.checkForUpdates.mockResolvedValue({ updateAvailable: true, latestVersion: '2.0.0' })
		mockChecker.preflightCheck.mockResolvedValue({ ok: false, reason: 'Docker not running' })
		const res = await POST(makeEvent())
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.error).toContain('Docker not running')
	})

	it('starts update and returns updating status', async () => {
		mockChecker.isUpdating.mockReturnValue(false)
		mockChecker.checkForUpdates.mockResolvedValue({ updateAvailable: true, latestVersion: '2.0.0' })
		mockChecker.preflightCheck.mockResolvedValue({ ok: true })
		mockChecker.performUpdate.mockResolvedValue(undefined)

		const res = await POST(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ status: 'updating', targetVersion: '2.0.0' })
	})
})
