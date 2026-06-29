import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}))

import { createCaddyClient } from './index'
import { repairDomainRoute } from './repair'

const mockCreateCaddyClient = vi.mocked(createCaddyClient)

function makeCaddyMock(
	addRouteResult: { success: boolean },
	addRedirectResult: { success: boolean } = { success: true }
) {
	return {
		addRoute: vi.fn().mockResolvedValue(addRouteResult),
		addRedirectRoute: vi.fn().mockResolvedValue(addRedirectResult)
	}
}

beforeEach(() => vi.clearAllMocks())

describe('repairDomainRoute', () => {
	it('adds a route and a www redirect for non-www hostnames', async () => {
		const caddy = makeCaddyMock({ success: true })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(true)
		expect(caddy.addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3000 })
		expect(caddy.addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
	})

	it('returns true for www. hostnames without adding a redirect', async () => {
		const caddy = makeCaddyMock({ success: true })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		const result = await repairDomainRoute('www.example.com', 3000)

		expect(result).toBe(true)
		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when addRoute fails', async () => {
		const caddy = makeCaddyMock({ success: false })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		expect(await repairDomainRoute('example.com', 3000)).toBe(false)
		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when addRedirectRoute fails', async () => {
		const caddy = makeCaddyMock({ success: true }, { success: false })
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		expect(await repairDomainRoute('example.com', 3000)).toBe(false)
	})

	it('returns false when createCaddyClient throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('caddy unavailable')
		})

		expect(await repairDomainRoute('example.com', 3000)).toBe(false)
	})

	it('returns false when addRoute rejects', async () => {
		const caddy = {
			addRoute: vi.fn().mockRejectedValue(new Error('network error')),
			addRedirectRoute: vi.fn()
		}
		mockCreateCaddyClient.mockReturnValue(caddy as never)

		expect(await repairDomainRoute('example.com', 3000)).toBe(false)
	})
})
