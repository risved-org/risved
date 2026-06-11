import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))

vi.mock('../(dashboard)/+layout.server', () => ({
	_getSystemHealth: vi.fn().mockReturnValue({
		cpuPercent: 14,
		memoryPercent: 52,
		diskPercent: 28,
		uptime: '2d 6h'
	})
}))

vi.mock('node:os', () => ({
	default: {
		hostname: vi.fn().mockReturnValue('fallback-host')
	}
}))

import { getSetting } from '$lib/server/settings'
import { load } from './+layout.server'

const mockGetSetting = getSetting as ReturnType<typeof vi.fn>

/* ── Tests ────────────────────────────────────────────────────────── */

describe('settings layout load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns system health from _getSystemHealth', async () => {
		mockGetSetting.mockResolvedValueOnce('My Server').mockResolvedValueOnce('deploy.example.com')

		const result = await load({} as never)

		expect(result.health).toMatchObject({ cpuPercent: 14, memoryPercent: 52 })
	})

	it('returns displayName and hostname from settings', async () => {
		mockGetSetting.mockResolvedValueOnce('Staging').mockResolvedValueOnce('staging.example.com')

		const result = await load({} as never)

		expect(result.displayName).toBe('Staging')
		expect(result.hostname).toBe('staging.example.com')
	})

	it('uses empty string when display_name is not set', async () => {
		mockGetSetting.mockResolvedValueOnce(null).mockResolvedValueOnce('h.example.com')

		const result = await load({} as never)

		expect(result.displayName).toBe('')
	})

	it('falls back to os.hostname() when hostname setting is not set', async () => {
		mockGetSetting.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

		const result = await load({} as never)

		expect(result.hostname).toBe('fallback-host')
	})
})
