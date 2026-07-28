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
	it('re-adds the route and its www redirect for a non-www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true })
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('app.example.com', 3001)

		expect(result).toBe(true)
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.com', port: 3001 })
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.com', 'app.example.com')
	})

	it('skips the redirect route when the hostname already has a www prefix', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn()
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('www.example.com', 3001)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the primary route fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false })
		const addRedirectRoute = vi.fn()
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('app.example.com', 3001)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the redirect route fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false })
		mockCreateCaddyClient.mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('app.example.com', 3001)

		expect(result).toBe(false)
	})

	it('returns false when creating the caddy client throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('connection refused')
		})

		const result = await repairDomainRoute('app.example.com', 3001)

		expect(result).toBe(false)
	})
})
