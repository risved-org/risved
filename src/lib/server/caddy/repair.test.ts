import { describe, it, expect, vi, beforeEach } from 'vitest'

const addRoute = vi.fn()
const addRedirectRoute = vi.fn()
const createCaddyClient = vi.fn(() => ({ addRoute, addRedirectRoute }))

vi.mock('./index', () => ({
	createCaddyClient: (...args: unknown[]) => createCaddyClient(...args)
}))

import { repairDomainRoute } from './repair'

describe('repairDomainRoute', () => {
	beforeEach(() => {
		addRoute.mockReset()
		addRedirectRoute.mockReset()
	})

	it('re-adds the route and its www redirect', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('myapp.example.eu', 3001)

		expect(result).toBe(true)
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'myapp.example.eu', port: 3001 })
		expect(addRedirectRoute).toHaveBeenCalledWith('www.myapp.example.eu', 'myapp.example.eu')
	})

	it('skips the www redirect for hostnames already prefixed with www', async () => {
		addRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('www.example.eu', 3001)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the route fails to apply', async () => {
		addRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('myapp.example.eu', 3001)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the redirect route fails to apply', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('myapp.example.eu', 3001)

		expect(result).toBe(false)
	})

	it('returns false when the caddy client throws', async () => {
		addRoute.mockRejectedValue(new Error('network error'))

		const result = await repairDomainRoute('myapp.example.eu', 3001)

		expect(result).toBe(false)
	})
})
