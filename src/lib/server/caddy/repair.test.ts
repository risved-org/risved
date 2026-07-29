import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}))

import { createCaddyClient } from './index'
import { repairDomainRoute } from './repair'

const mockCreateCaddyClient = vi.mocked(createCaddyClient)

function mockCaddy(overrides: Partial<{ addRoute: unknown, addRedirectRoute: unknown }> = {}) {
	return {
		addRoute: vi.fn().mockResolvedValue({ success: true }),
		addRedirectRoute: vi.fn().mockResolvedValue({ success: true }),
		...overrides
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('repairDomainRoute', () => {
	it('adds a redirect route for the www variant when the route succeeds', async () => {
		const caddy = mockCaddy()
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('app.example.com', 4001)

		expect(caddy.addRoute).toHaveBeenCalledWith({ hostname: 'app.example.com', port: 4001 })
		expect(caddy.addRedirectRoute).toHaveBeenCalledWith('www.app.example.com', 'app.example.com')
		expect(result).toBe(true)
	})

	it('does not add a redirect route when hostname already starts with www.', async () => {
		const caddy = mockCaddy()
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('www.app.example.com', 4001)

		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
		expect(result).toBe(true)
	})

	it('returns false without adding a redirect when the primary route fails', async () => {
		const caddy = mockCaddy({ addRoute: vi.fn().mockResolvedValue({ success: false }) })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('app.example.com', 4001)

		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
		expect(result).toBe(false)
	})

	it('returns false when the redirect route fails', async () => {
		const caddy = mockCaddy({ addRedirectRoute: vi.fn().mockResolvedValue({ success: false }) })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('app.example.com', 4001)

		expect(result).toBe(false)
	})

	it('returns false when createCaddyClient throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('config missing')
		})

		const result = await repairDomainRoute('app.example.com', 4001)

		expect(result).toBe(false)
	})

	it('returns false when addRoute rejects', async () => {
		const caddy = mockCaddy({ addRoute: vi.fn().mockRejectedValue(new Error('network error')) })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('app.example.com', 4001)

		expect(result).toBe(false)
	})
})
