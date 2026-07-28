import { describe, it, expect, vi, beforeEach } from 'vitest'

const addRoute = vi.fn()
const addRedirectRoute = vi.fn()
const createCaddyClient = vi.fn(() => ({ addRoute, addRedirectRoute }))

vi.mock('./index', () => ({
	createCaddyClient: (...args: unknown[]) => createCaddyClient(...args)
}))

const { repairDomainRoute } = await import('./repair')

describe('repairDomainRoute', () => {
	beforeEach(() => {
		addRoute.mockReset()
		addRedirectRoute.mockReset()
		createCaddyClient.mockClear()
		createCaddyClient.mockImplementation(() => ({ addRoute, addRedirectRoute }))
	})

	it('returns false when the route fails to apply', async () => {
		addRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('adds a www redirect for an apex hostname and returns its result', async () => {
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

	it('skips the redirect and returns true for a www hostname', async () => {
		addRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('www.example.com', 3000)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when creating the caddy client throws', async () => {
		createCaddyClient.mockImplementation(() => {
			throw new Error('boom')
		})

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
	})

	it('returns false when addRoute rejects', async () => {
		addRoute.mockRejectedValue(new Error('network error'))

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
	})
})
