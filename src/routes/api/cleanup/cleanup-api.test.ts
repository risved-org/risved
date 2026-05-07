import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockManager = vi.hoisted(() => ({
	getDockerDiskUsage: vi.fn(),
	runCleanup: vi.fn(),
	dockerPrune: vi.fn()
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn(),
	setSetting: vi.fn()
}))
vi.mock('$lib/server/cleanup', () => ({
	getCleanupManager: vi.fn(() => mockManager)
}))

import { getSetting, setSetting } from '$lib/server/settings'

function makeEvent(body: unknown) {
	return {
		locals: { user: { id: 'user-1' } },
		request: {
			headers: { get: () => null },
			json: vi.fn().mockResolvedValue(body)
		},
		url: new URL('http://localhost/api/cleanup')
	} as never
}

describe('GET /api/cleanup', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns retention days and disk usage', async () => {
		vi.mocked(getSetting).mockResolvedValue('14')
		mockManager.getDockerDiskUsage.mockResolvedValue({ total: '1GB' })

		const { GET } = await import('./+server')
		const res = await GET(makeEvent(null))

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.retentionDays).toBe(14)
		expect(data.diskUsage).toEqual({ total: '1GB' })
	})

	it('defaults retention to 30 when setting is null', async () => {
		vi.mocked(getSetting).mockResolvedValue(null)
		mockManager.getDockerDiskUsage.mockResolvedValue({})

		const { GET } = await import('./+server')
		const res = await GET(makeEvent(null))
		const data = await res.json()
		expect(data.retentionDays).toBe(30)
	})
})

describe('POST /api/cleanup — updateRetention', () => {
	beforeEach(() => vi.clearAllMocks())

	it('saves valid retention days', async () => {
		vi.mocked(setSetting).mockResolvedValue(undefined)

		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'updateRetention', days: 7 }))

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.retentionDays).toBe(7)
		expect(setSetting).toHaveBeenCalledWith('log_retention_days', '7')
	})

	it('returns 400 for invalid days (< 1)', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'updateRetention', days: 0 }))
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid days (> 365)', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'updateRetention', days: 400 }))
		expect(res.status).toBe(400)
	})

	it('returns 400 for non-numeric days', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'updateRetention', days: 'abc' }))
		expect(res.status).toBe(400)
	})
})

describe('POST /api/cleanup — runCleanup', () => {
	beforeEach(() => vi.clearAllMocks())

	it('runs cleanup and returns result', async () => {
		mockManager.runCleanup.mockResolvedValue({ deleted: 5 })

		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'runCleanup' }))

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.result).toEqual({ deleted: 5 })
	})
})

describe('POST /api/cleanup — dockerPrune', () => {
	beforeEach(() => vi.clearAllMocks())

	it('prunes images and returns result', async () => {
		mockManager.dockerPrune.mockResolvedValue({ freed: '200MB' })

		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'dockerPrune', type: 'images' }))

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.result).toEqual({ freed: '200MB' })
	})

	it('returns 400 for invalid prune type', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'dockerPrune', type: 'invalid' }))
		expect(res.status).toBe(400)
	})
})

describe('POST /api/cleanup — unknown action', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 for unknown action', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ action: 'doSomethingElse' }))
		expect(res.status).toBe(400)
	})
})
