import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAddRoute, mockAddRedirectRoute } = vi.hoisted(() => ({
	mockAddRoute: vi.fn(),
	mockAddRedirectRoute: vi.fn()
}))

vi.mock('./index', () => ({
	createCaddyClient: vi.fn(() => ({
		addRoute: mockAddRoute,
		addRedirectRoute: mockAddRedirectRoute
	}))
}))

import { repairDomainRoute } from './repair'

beforeEach(() => vi.clearAllMocks())

describe('repairDomainRoute', () => {
	it('returns false when addRoute fails', async () => {
		mockAddRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('example.com', 3001)
		expect(result).toBe(false)
		expect(mockAddRedirectRoute).not.toHaveBeenCalled()
	})

	it('adds www redirect for non-www hostname and returns true', async () => {
		mockAddRoute.mockResolvedValue({ success: true })
		mockAddRedirectRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('example.com', 3001)
		expect(result).toBe(true)
		expect(mockAddRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('returns false when redirect route fails', async () => {
		mockAddRoute.mockResolvedValue({ success: true })
		mockAddRedirectRoute.mockResolvedValue({ success: false })

		const result = await repairDomainRoute('example.com', 3001)
		expect(result).toBe(false)
	})

	it('skips www redirect for www hostname and returns true', async () => {
		mockAddRoute.mockResolvedValue({ success: true })

		const result = await repairDomainRoute('www.example.com', 3001)
		expect(result).toBe(true)
		expect(mockAddRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when an exception is thrown', async () => {
		mockAddRoute.mockRejectedValue(new Error('caddy unreachable'))

		const result = await repairDomainRoute('example.com', 3001)
		expect(result).toBe(false)
	})
})
