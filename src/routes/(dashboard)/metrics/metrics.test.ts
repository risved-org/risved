import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetServerMetrics } = vi.hoisted(() => ({
	mockGetServerMetrics: vi.fn().mockResolvedValue([])
}))

vi.mock('$lib/server/metrics', () => ({
	getServerMetrics: mockGetServerMetrics
}))

import { load } from './+page.server'

function makeLoadEvent(hours?: string) {
	const url = new URL('http://localhost/')
	if (hours) url.searchParams.set('hours', hours)
	return { url } as unknown as Parameters<typeof load>[0]
}

beforeEach(() => vi.clearAllMocks())

describe('dashboard metrics load', () => {
	it('uses default 24h window when no param provided', async () => {
		mockGetServerMetrics.mockResolvedValueOnce([{ cpu: 5 }])

		const result = await load(makeLoadEvent())
		expect(result.hours).toBe(24)
		expect(mockGetServerMetrics).toHaveBeenCalledWith(24)
	})

	it('accepts valid hours values', async () => {
		for (const h of [6, 12, 24, 48, 168]) {
			mockGetServerMetrics.mockResolvedValueOnce([])
			const result = await load(makeLoadEvent(String(h)))
			expect(result.hours).toBe(h)
		}
	})

	it('falls back to 24h for invalid hours value', async () => {
		mockGetServerMetrics.mockResolvedValueOnce([])

		const result = await load(makeLoadEvent('999'))
		expect(result.hours).toBe(24)
	})

	it('returns serverMetrics from the service', async () => {
		const metrics = [{ timestamp: '2026-01-01', cpu: 42 }]
		mockGetServerMetrics.mockResolvedValueOnce(metrics)

		const result = await load(makeLoadEvent('6'))
		expect(result.serverMetrics).toEqual(metrics)
	})
})
