import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))

import { getSetting } from '$lib/server/settings'
import { getManagedAppDomain } from './domains'

describe('getManagedAppDomain', () => {
	it('returns null when domain_config is not set', async () => {
		vi.mocked(getSetting).mockResolvedValue(null)

		const result = await getManagedAppDomain('my-app')

		expect(result).toBeNull()
	})

	it('returns null when domain_config is malformed JSON', async () => {
		vi.mocked(getSetting).mockResolvedValue('not-json')

		const result = await getManagedAppDomain('my-app')

		expect(result).toBeNull()
	})

	it('returns null when mode is not subdomain', async () => {
		vi.mocked(getSetting).mockResolvedValue(
			JSON.stringify({ mode: 'custom', baseDomain: 'example.com' })
		)

		const result = await getManagedAppDomain('my-app')

		expect(result).toBeNull()
	})

	it('returns null when baseDomain is missing', async () => {
		vi.mocked(getSetting).mockResolvedValue(JSON.stringify({ mode: 'subdomain' }))

		const result = await getManagedAppDomain('my-app')

		expect(result).toBeNull()
	})

	it('returns the managed subdomain when configured', async () => {
		vi.mocked(getSetting).mockResolvedValue(
			JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com' })
		)

		const result = await getManagedAppDomain('my-app')

		expect(result).toBe('my-app.example.com')
	})

	it('returns null when currentDomain already matches the managed domain', async () => {
		vi.mocked(getSetting).mockResolvedValue(
			JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com' })
		)

		const result = await getManagedAppDomain('my-app', 'my-app.example.com')

		expect(result).toBeNull()
	})
})
