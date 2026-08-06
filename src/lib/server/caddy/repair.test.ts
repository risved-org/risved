import { describe, it, expect, vi, beforeEach } from 'vitest'
import { repairDomainRoute } from './repair'
import { createCaddyClient } from './index'

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}))

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns false when the primary route fails to apply', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false, error: 'boom' })
		const addRedirectRoute = vi.fn()
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('app.risved.example.eu', 3000)

		expect(result).toBe(false)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('also re-applies the www redirect route for a non-www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true })
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('app.risved.example.eu', 3000)

		expect(result).toBe(true)
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.risved.example.eu', port: 3000 })
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.risved.example.eu', 'app.risved.example.eu')
	})

	it('returns false when the redirect route fails to apply', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false, error: 'redirect failed' })
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('app.risved.example.eu', 3000)

		expect(result).toBe(false)
	})

	it('skips the redirect route for a hostname already prefixed with www', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true })
		const addRedirectRoute = vi.fn()
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never)

		const result = await repairDomainRoute('www.app.risved.example.eu', 3000)

		expect(result).toBe(true)
		expect(addRedirectRoute).not.toHaveBeenCalled()
	})

	it('returns false when the Caddy client throws', async () => {
		vi.mocked(createCaddyClient).mockImplementation(() => {
			throw new Error('client unavailable')
		})

		const result = await repairDomainRoute('app.risved.example.eu', 3000)

		expect(result).toBe(false)
	})
})
