import { describe, it, expect, vi, beforeEach } from 'vitest'
import os from 'node:os'

const { mockGetSetting, mockGetSystemHealth } = vi.hoisted(() => ({
	mockGetSetting: vi.fn(),
	mockGetSystemHealth: vi.fn().mockReturnValue({ cpuPercent: 10, memoryPercent: 40, diskPercent: 20 })
}))

vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../(dashboard)/+layout.server', () => ({
	_getSystemHealth: mockGetSystemHealth
}))
vi.mock('node:os', () => ({
	default: { hostname: vi.fn().mockReturnValue('server-box') }
}))

import { load } from './+layout.server'

beforeEach(() => vi.clearAllMocks())

describe('settings layout load', () => {
	it('returns health from _getSystemHealth', async () => {
		mockGetSetting.mockResolvedValueOnce('My Server').mockResolvedValueOnce('custom.host')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.health).toMatchObject({ cpuPercent: 10 })
	})

	it('returns displayName from getSetting', async () => {
		mockGetSetting.mockResolvedValueOnce('My Server').mockResolvedValueOnce('')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.displayName).toBe('My Server')
	})

	it('falls back to empty string when display_name is null', async () => {
		mockGetSetting.mockResolvedValueOnce(null).mockResolvedValueOnce('')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.displayName).toBe('')
	})

	it('uses getSetting hostname when set', async () => {
		mockGetSetting.mockResolvedValueOnce('').mockResolvedValueOnce('my-host.example.com')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.hostname).toBe('my-host.example.com')
	})

	it('falls back to os.hostname() when hostname setting is empty', async () => {
		mockGetSetting.mockResolvedValueOnce('').mockResolvedValueOnce('')
		vi.mocked(os.hostname).mockReturnValue('fallback-host')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.hostname).toBe('fallback-host')
	})
})
