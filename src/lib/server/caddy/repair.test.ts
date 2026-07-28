import { describe, it, expect, vi } from 'vitest'

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

describe('repairDomainRoute', () => {
	it('returns false when adding the primary route fails', async () => {
		const caddy = mockCaddy(false)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(false)
		expect(caddy.addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 4001 })
		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
	})

	it('adds a www redirect route and returns its success for a non-www hostname', async () => {
		const caddy = mockCaddy(true, true)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(true)
		expect(caddy.addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('returns false when the www redirect route fails', async () => {
		const caddy = mockCaddy(true, false)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(false)
	})

	it('does not add a redirect route when hostname already starts with www', async () => {
		const caddy = mockCaddy(true)
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('www.example.com', 4001)

		expect(result).toBe(true)
		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the caddy client throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('connection refused')
		})

		const result = await repairDomainRoute('example.com', 4001)

		expect(result).toBe(false)
	})
})
