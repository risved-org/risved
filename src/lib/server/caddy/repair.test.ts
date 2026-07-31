import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}))

import { createCaddyClient } from './index'
import { repairDomainRoute } from './repair'

const mockCreateCaddyClient = vi.mocked(createCaddyClient)

function mockCaddy(addRouteSuccess: boolean, addRedirectRouteSuccess = true) {
	return {
		addRoute: vi.fn().mockResolvedValue({ success: addRouteSuccess }),
		addRedirectRoute: vi.fn().mockResolvedValue({ success: addRedirectRouteSuccess })
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('repairDomainRoute', () => {
	it('re-adds the route and a www redirect for a bare hostname', async () => {
		const caddy = mockCaddy(true, true)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(caddy.addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 4001 })
		expect(caddy.addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
		expect(result).toBe(true)
	})

	it('skips the www redirect when the hostname already has a www prefix', async () => {
		const caddy = mockCaddy(true)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('www.example.com', 4001)

		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
		expect(result).toBe(true)
	})

	it('returns false when the primary route fails', async () => {
		const caddy = mockCaddy(false)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
		expect(result).toBe(false)
	})

	it('returns false when the www redirect fails', async () => {
		const caddy = mockCaddy(true, false)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

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
