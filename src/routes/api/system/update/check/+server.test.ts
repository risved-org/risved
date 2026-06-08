import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCheckForUpdates, mockGetUpdateChecker } = vi.hoisted(() => {
	const mockCheckForUpdates = vi.fn()
	const mockGetUpdateChecker = vi.fn(() => ({ checkForUpdates: mockCheckForUpdates }))
	return { mockCheckForUpdates, mockGetUpdateChecker }
})

vi.mock('$lib/server/update', () => ({ getUpdateChecker: mockGetUpdateChecker }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' })
}))
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown) => new Response(JSON.stringify(body), { status: 200 }))
}))

function makeEvent() {
	return {
		request: new Request('http://localhost/'),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/')
	}
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/system/update/check', () => {
	it('returns update info from checkForUpdates', async () => {
		const updateInfo = {
			currentVersion: '1.0.0',
			latestVersion: '1.1.0',
			updateAvailable: true,
			releaseNotes: 'Bug fixes',
			checkedAt: '2026-01-01T00:00:00Z',
			error: null
		}
		mockCheckForUpdates.mockResolvedValue(updateInfo)

		const { POST } = await import('./+server')
		const resp = await POST(makeEvent() as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ currentVersion: '1.0.0', updateAvailable: true })
	})

	it('calls checkForUpdates on the checker instance', async () => {
		mockCheckForUpdates.mockResolvedValue({ currentVersion: '1.0.0', updateAvailable: false })

		const { POST } = await import('./+server')
		await POST(makeEvent() as never)
		expect(mockGetUpdateChecker).toHaveBeenCalled()
		expect(mockCheckForUpdates).toHaveBeenCalled()
	})
})
