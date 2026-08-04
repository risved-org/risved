import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAddRoute = vi.fn()
const mockAddRedirectRoute = vi.fn()
const mockCreateCaddyClient = vi.fn(() => ({
	addRoute: mockAddRoute,
	addRedirectRoute: mockAddRedirectRoute
}))

vi.mock('./index', () => ({
	createCaddyClient: (...args: unknown[]) => mockCreateCaddyClient(...args)
}))

const { repairDomainRoute } = await import('./repair')

describe('repairDomainRoute', () => {
	beforeEach(() => {
		mockAddRoute.mockReset()
		mockAddRedirectRoute.mockReset()
		mockCreateCaddyClient.mockClear()
	})

	it('returns false when the route cannot be added', async () => {
		mockAddRoute.mockResolvedValue({ success: false })
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
		expect(mockAddRedirectRoute).not.toHaveBeenCalled()
	})

	it('adds a www redirect and returns its success for a bare hostname', async () => {
		mockAddRoute.mockResolvedValue({ success: true })
		mockAddRedirectRoute.mockResolvedValue({ success: true })
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(true)
		expect(mockAddRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3000 })
		expect(mockAddRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('returns false when the www redirect route fails', async () => {
		mockAddRoute.mockResolvedValue({ success: true })
		mockAddRedirectRoute.mockResolvedValue({ success: false })
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
	})

	it('skips the redirect route for hostnames already prefixed with www', async () => {
		mockAddRoute.mockResolvedValue({ success: true })
		const result = await repairDomainRoute('www.example.com', 3000)
		expect(result).toBe(true)
		expect(mockAddRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when createCaddyClient throws', async () => {
		mockCreateCaddyClient.mockImplementationOnce(() => {
			throw new Error('unreachable control plane')
		})
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
	})

	it('returns false when addRoute rejects', async () => {
		mockAddRoute.mockRejectedValue(new Error('network error'))
		const result = await repairDomainRoute('example.com', 3000)
		expect(result).toBe(false)
	})
})
