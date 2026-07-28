import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}))

import { createCaddyClient } from './index'
import { repairDomainRoute } from './repair'

const mockCreateCaddyClient = vi.mocked(createCaddyClient)

function mockCaddy(overrides: Partial<{ addRoute: unknown; addRedirectRoute: unknown }> = {}) {
	return {
		addRoute: vi.fn().mockResolvedValue({ success: true }),
		addRedirectRoute: vi.fn().mockResolvedValue({ success: true }),
		...overrides
	} as unknown as ReturnType<typeof createCaddyClient>
}

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('re-adds the route and the www redirect for a bare hostname', async () => {
		const caddy = mockCaddy()
		mockCreateCaddyClient.mockReturnValue(caddy)

		const result = await repairDomainRoute('example.com', 3000)

		expect(caddy.addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3000 })
		expect(caddy.addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com')
		expect(result).toBe(true)
	})

	it('skips the redirect for a www hostname', async () => {
		const caddy = mockCaddy()
		mockCreateCaddyClient.mockReturnValue(caddy)

		const result = await repairDomainRoute('www.example.com', 3000)

		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
		expect(result).toBe(true)
	})

	it('returns false when the route fails to apply', async () => {
		const caddy = mockCaddy({ addRoute: vi.fn().mockResolvedValue({ success: false }) })
		mockCreateCaddyClient.mockReturnValue(caddy)

		const result = await repairDomainRoute('example.com', 3000)

		expect(caddy.addRedirectRoute).not.toHaveBeenCalled()
		expect(result).toBe(false)
	})

	it('returns false when the redirect fails to apply', async () => {
		const caddy = mockCaddy({
			addRedirectRoute: vi.fn().mockResolvedValue({ success: false })
		})
		mockCreateCaddyClient.mockReturnValue(caddy)

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
	})

	it('returns false when the caddy client throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('unreachable')
		})

		const result = await repairDomainRoute('example.com', 3000)

		expect(result).toBe(false)
	})
})
