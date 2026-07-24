import { describe, it, expect, vi, beforeEach } from 'vitest'

const addRoute = vi.fn()
const addRedirectRoute = vi.fn()

vi.mock('./index', () => ({
	createCaddyClient: () => ({ addRoute, addRedirectRoute })
}))

import { repairDomainRoute } from './repair'

describe('repairDomainRoute', () => {
	beforeEach(() => {
		addRoute.mockReset()
		addRedirectRoute.mockReset()
	})

	it('returns false when the base route fails to apply', async () => {
		addRoute.mockResolvedValue({ success: false })
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('adds a www redirect route for a bare hostname and returns its result', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: true })
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(true)
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3000 })
		expect(addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('returns false when the www redirect route fails', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: false })
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
	})

	it('skips the redirect route for hostnames already prefixed with www', async () => {
		addRoute.mockResolvedValue({ success: true })
		const result = await repairDomainRoute('www.example.com', 3000)
		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when addRoute throws', async () => {
		addRoute.mockRejectedValue(new Error('boom'))
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
	})
})
