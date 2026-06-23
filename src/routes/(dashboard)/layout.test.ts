import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
	execSync: vi.fn((cmd: string) => {
		if (cmd.includes('df -h')) return '/dev/sda1  50G  20G  28G  42% /\n'
		return ''
	})
}))

vi.mock('node:os', () => ({
	default: {
		cpus: () => [{ times: { user: 50, nice: 0, sys: 20, idle: 30, irq: 0 } }],
		totalmem: () => 8_000_000_000,
		freemem: () => 4_000_000_000,
		hostname: () => 'test-host',
		uptime: () => 3601
	}
}))

vi.mock('$lib/server/settings', () => {
	const getSetting = vi.fn()
	return { getSetting, __getSetting: getSetting }
})

import { getSetting } from '$lib/server/settings'
import { load } from './+layout.server'

const mockGetSetting = getSetting as ReturnType<typeof vi.fn>

describe('dashboard layout load', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns health, displayName, and hostname from settings', async () => {
		mockGetSetting
			.mockResolvedValueOnce('My Server')
			.mockResolvedValueOnce('my-server.example.com')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.displayName).toBe('My Server')
		expect(result.hostname).toBe('my-server.example.com')
		expect(result.health).toBeDefined()
	})

	it('falls back to empty string when display_name setting is null', async () => {
		mockGetSetting
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('host.example.com')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.displayName).toBe('')
	})

	it('falls back to os.hostname() when hostname setting is null', async () => {
		mockGetSetting
			.mockResolvedValueOnce('My App')
			.mockResolvedValueOnce(null)

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.hostname).toBe('test-host')
	})

	it('includes cpu, memory, and disk from system health', async () => {
		mockGetSetting.mockResolvedValue('')

		const result = await load({} as Parameters<typeof load>[0])
		expect(result.health.diskPercent).toBe(42)
		expect(result.health.memoryPercent).toBe(50)
		expect(result.health.cpuPercent).toBeGreaterThanOrEqual(0)
	})
})
