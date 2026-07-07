import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}))

import { createCaddyClient } from './index'
import { repairDomainRoute } from './repair'

const mockCreateCaddyClient = vi.mocked(createCaddyClient)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('repairDomainRoute', () => {
	it('adds the route and a www redirect for a non-www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true })
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(true)
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 4001 })
		expect(addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('skips the www redirect when the hostname already starts with www', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn()
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('www.example.com', 4001)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the primary route fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false })
		const addRedirectRoute = vi.fn()
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns the redirect route result when it fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false })
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(false)
	})

	it('returns false when the caddy client throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('connection refused')
		})

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(false)
	})
})
