import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockManager = {
	getDockerDiskUsage: vi.fn(),
	runCleanup: vi.fn(),
	dockerPrune: vi.fn()
}

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' }),
	jsonError: vi.fn((status: number, msg: string) =>
		new Response(JSON.stringify({ error: msg }), { status })
	)
}))

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn(),
	setSetting: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('$lib/server/cleanup', () => ({
	getCleanupManager: vi.fn()
}))

import { getSetting } from '$lib/server/settings'
import { getCleanupManager } from '$lib/server/cleanup'
import { GET, POST } from './+server'

function makeEvent(method = 'GET', body?: unknown) {
	return {
		locals: {},
		request: new Request('http://localhost/api/cleanup', {
			method,
			headers: { 'content-type': 'application/json' },
			body: body != null ? JSON.stringify(body) : undefined
		})
	} as Parameters<typeof GET>[0]
}

describe('GET /api/cleanup', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCleanupManager).mockReturnValue(mockManager as unknown as ReturnType<typeof getCleanupManager>)
	})

	it('returns retentionDays and diskUsage', async () => {
		vi.mocked(getSetting).mockResolvedValue('14')
		mockManager.getDockerDiskUsage.mockResolvedValue({ total: '1GB' })

		const res = await GET(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.retentionDays).toBe(14)
		expect(body.diskUsage).toEqual({ total: '1GB' })
	})

	it('defaults retentionDays to 30 when setting is null', async () => {
		vi.mocked(getSetting).mockResolvedValue(null)
		mockManager.getDockerDiskUsage.mockResolvedValue({})
		const res = await GET(makeEvent())
		const body = await res.json()
		expect(body.retentionDays).toBe(30)
	})
})

describe('POST /api/cleanup', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCleanupManager).mockReturnValue(mockManager as unknown as ReturnType<typeof getCleanupManager>)
	})

	it('updateRetention: saves valid days and returns success', async () => {
		const res = await POST(makeEvent('POST', { action: 'updateRetention', days: '7' }))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ success: true, retentionDays: 7 })
	})

	it('updateRetention: rejects days out of range', async () => {
		const res = await POST(makeEvent('POST', { action: 'updateRetention', days: '0' }))
		expect(res.status).toBe(400)
	})

	it('updateRetention: rejects days > 365', async () => {
		const res = await POST(makeEvent('POST', { action: 'updateRetention', days: '400' }))
		expect(res.status).toBe(400)
	})

	it('runCleanup: runs and returns result', async () => {
		mockManager.runCleanup.mockResolvedValue({ deleted: 5 })
		const res = await POST(makeEvent('POST', { action: 'runCleanup' }))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ success: true, result: { deleted: 5 } })
	})

	it('dockerPrune: prunes images', async () => {
		mockManager.dockerPrune.mockResolvedValue({ freed: '200MB' })
		const res = await POST(makeEvent('POST', { action: 'dockerPrune', type: 'images' }))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ success: true, result: { freed: '200MB' } })
	})

	it('dockerPrune: rejects invalid type', async () => {
		const res = await POST(makeEvent('POST', { action: 'dockerPrune', type: 'badtype' }))
		expect(res.status).toBe(400)
	})

	it('returns 400 for unknown action', async () => {
		const res = await POST(makeEvent('POST', { action: 'unknown' }))
		expect(res.status).toBe(400)
	})
})
