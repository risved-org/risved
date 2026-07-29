import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}));

import { getSetting } from '$lib/server/settings'
import { getManagedAppDomain } from './domains'

const mockGetSetting = vi.mocked(getSetting)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('getManagedAppDomain', () => {
	it('returns null when no domain_config setting exists', async () => {
		mockGetSetting.mockResolvedValue(null)
		const result = await getManagedAppDomain('my-app')
		expect(result).toBeNull()
	})

	it('returns null when domain_config is not valid JSON', async () => {
		mockGetSetting.mockResolvedValue('not-json')
		const result = await getManagedAppDomain('my-app')
		expect(result).toBeNull()
	})

	it('returns null when mode is not subdomain', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({ mode: 'dedicated', baseDomain: 'example.com' }))
		const result = await getManagedAppDomain('my-app')
		expect(result).toBeNull()
	})

	it('returns null when baseDomain is missing', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({ mode: 'subdomain' }))
		const result = await getManagedAppDomain('my-app')
		expect(result).toBeNull()
	})

	it('returns the managed domain for subdomain mode', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com' }))
		const result = await getManagedAppDomain('my-app')
		expect(result).toBe('my-app.example.com')
	})

	it('returns null when the current domain already matches the managed domain', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com' }))
		const result = await getManagedAppDomain('my-app', 'my-app.example.com')
		expect(result).toBeNull()
	})

	it('returns the managed domain when the current domain differs', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com' }))
		const result = await getManagedAppDomain('my-app', 'custom.example.com')
		expect(result).toBe('my-app.example.com')
	})
})
