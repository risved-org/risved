import { describe, it, expect, vi, beforeEach } from 'vitest'

const addRoute = vi.fn()
const addRedirectRoute = vi.fn()
const createCaddyClient = vi.fn(() => ({ addRoute, addRedirectRoute }))

vi.mock('./index', () => ({ createCaddyClient }))

const { repairDomainRoute } = await import('./repair')

beforeEach(() => {
	addRoute.mockReset()
	addRedirectRoute.mockReset()
})

describe('repairDomainRoute', () => {
	it('re-adds the route and the www redirect for a bare hostname', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('example.com', 3001)

		expect(result).toBe(true)
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3001 })
		expect(addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('skips the redirect route when the hostname is already a www subdomain', async () => {
		addRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('www.example.com', 3001)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when adding the primary route fails', async () => {
		addRoute.mockResolvedValue({ success: false, error: 'boom' })

		const result = await repairDomainRoute('example.com', 3001)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the redirect route fails', async () => {
		addRoute.mockResolvedValue({ success: true })
		addRedirectRoute.mockResolvedValue({ success: false, error: 'boom' })

		const result = await repairDomainRoute('example.com', 3001)

		expect(result).toBe(false)
	})

	it('returns false when the caddy client throws', async () => {
		addRoute.mockRejectedValue(new Error('network error'))

		const result = await repairDomainRoute('example.com', 3001)

		expect(result).toBe(false)
	})
})
