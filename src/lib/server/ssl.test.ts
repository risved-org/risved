import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockConnect } = vi.hoisted(() => ({
	mockConnect: vi.fn()
}))

vi.mock('node:tls', () => ({
	connect: mockConnect
}))

import { hasValidCertificate, resolveSslStatus } from './ssl'

function makeSocket(opts: {
	onEvent: 'secureConnect' | 'error' | 'timeout'
	authorized?: boolean
}) {
	const handlers: Record<string, Array<() => void>> = {}
	const socket = {
		authorized: opts.authorized ?? false,
		once: vi.fn((event: string, cb: () => void) => {
			handlers[event] = handlers[event] ?? []
			handlers[event].push(cb)
		}),
		destroy: vi.fn()
	}
	setTimeout(() => {
		for (const cb of handlers[opts.onEvent] ?? []) cb()
	}, 0)
	return socket
}

beforeEach(() => vi.clearAllMocks())

describe('hasValidCertificate', () => {
	it('resolves true when socket reports authorized secureConnect', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'secureConnect', authorized: true }))

		const result = await hasValidCertificate('example.com')
		expect(result).toBe(true)
	})

	it('resolves false when socket is not authorized on secureConnect', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'secureConnect', authorized: false }))

		const result = await hasValidCertificate('example.com')
		expect(result).toBe(false)
	})

	it('resolves false on socket error', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'error' }))

		const result = await hasValidCertificate('example.com')
		expect(result).toBe(false)
	})

	it('resolves false on socket timeout', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'timeout' }))

		const result = await hasValidCertificate('example.com')
		expect(result).toBe(false)
	})

	it('connects to port 443 with the given hostname as servername', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'secureConnect', authorized: true }))

		await hasValidCertificate('myapp.example.com')
		expect(mockConnect).toHaveBeenCalledWith(
			expect.objectContaining({
				host: 'myapp.example.com',
				port: 443,
				servername: 'myapp.example.com',
				rejectUnauthorized: true
			})
		)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false)
		expect(status).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and certificate is valid', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'secureConnect', authorized: true }))

		const status = await resolveSslStatus('example.com', true)
		expect(status).toBe('active')
	})

	it('returns provisioning when DNS resolved but certificate is not yet valid', async () => {
		mockConnect.mockReturnValue(makeSocket({ onEvent: 'error' }))

		const status = await resolveSslStatus('example.com', true)
		expect(status).toBe('provisioning')
	})
})
