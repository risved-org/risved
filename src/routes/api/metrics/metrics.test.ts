import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('$lib/server/metrics', () => ({
	getServerMetrics: vi.fn()
}))

import { getServerMetrics } from '$lib/server/metrics'
import { GET } from './+server'

function makeEvent(searchParams: Record<string, string> = {}) {
	const url = new URL('http://localhost/api/metrics')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		url,
		locals: {},
		request: { headers: new Headers() }
	} as Parameters<typeof GET>[0]
}

describe('GET /api/metrics', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns metrics with default 24-hour window', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([])
		const res = await GET(makeEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ metrics: [] })
		expect(getServerMetrics).toHaveBeenCalledWith(24)
	})

	it('passes custom hours parameter', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([{ cpu: 10 }])
		const res = await GET(makeEvent({ hours: '48' }))
		expect(getServerMetrics).toHaveBeenCalledWith(48)
		expect(res.status).toBe(200)
	})

	it('clamps hours to maximum of 168', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([])
		await GET(makeEvent({ hours: '9999' }))
		expect(getServerMetrics).toHaveBeenCalledWith(168)
	})

	it('falls back to 24 for non-numeric hours', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([])
		await GET(makeEvent({ hours: 'abc' }))
		expect(getServerMetrics).toHaveBeenCalledWith(24)
	})
})
