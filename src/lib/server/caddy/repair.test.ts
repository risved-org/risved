import { describe, it, expect, vi, beforeEach } from 'vitest'

const addRoute = vi.fn()
const addRedirectRoute = vi.fn()

vi.mock('./index', () => ({
	createCaddyClient: vi.fn(() => ({
		addRoute,
		addRedirectRoute
	}))
}))

import { repairDomainRoute } from './repair'

describe('repairDomainRoute', () => {
	beforeEach(() => {
		addRoute.mockReset()
		addRedirectRoute.mockReset()
	})

	it('returns false when the route re-apply fails', async () => {
		addRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('skips the redirect route and returns true for www hostnames', async () => {
		addRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('www.example.com', 3000)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('re-applies the www redirect route for non-www hostnames', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(true)
		expect(addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('returns false when the www redirect route fails', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
	})

	it('returns false when the caddy client throws', async () => {
		addRoute.mockRejectedValue(new Error('caddy unreachable'))

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
	})
})
