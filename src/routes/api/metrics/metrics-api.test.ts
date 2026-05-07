import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' })
}))
vi.mock('$lib/server/metrics', () => ({
	getServerMetrics: vi.fn()
}))

import { getServerMetrics } from '$lib/server/metrics'

function makeEvent(searchParams: Record<string, string> = {}) {
	const url = new URL('http://localhost/api/metrics')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		locals: { user: { id: 'user-1' } },
		request: { headers: { get: () => null } },
		url
	} as never
}

describe('GET /api/metrics', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns metrics with default hours', async () => {
		const metrics = [{ ts: '2026-01-01', cpu: 10 }]
		vi.mocked(getServerMetrics).mockResolvedValue(metrics as never)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent())

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.metrics).toEqual(metrics)
		expect(getServerMetrics).toHaveBeenCalledWith(24)
	})

	it('passes custom hours to getServerMetrics', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({ hours: '48' }))

		expect(getServerMetrics).toHaveBeenCalledWith(48)
	})

	it('caps hours at 168', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({ hours: '9999' }))

		expect(getServerMetrics).toHaveBeenCalledWith(168)
	})

	it('falls back to 24 when hours is not a valid number', async () => {
		vi.mocked(getServerMetrics).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({ hours: 'notanumber' }))

		expect(getServerMetrics).toHaveBeenCalledWith(24)
	})
})
