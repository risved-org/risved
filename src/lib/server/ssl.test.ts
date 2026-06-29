import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('node:tls', () => ({ connect: vi.fn() }))

import { connect } from 'node:tls'
import { hasValidCertificate, resolveSslStatus } from './ssl'

const mockConnect = vi.mocked(connect)

function makeSocket(authorized = true) {
	const handlers: Record<string, Array<() => void>> = {}
	return {
		authorized,
		destroy: vi.fn(),
		once(event: string, handler: () => void) {
			handlers[event] ??= []
			handlers[event].push(handler)
		},
		emit(event: string) {
			for (const h of handlers[event] ?? []) h()
		}
	}
}

afterEach(() => vi.clearAllMocks())

describe('hasValidCertificate', () => {
	it('resolves true for an authorized connection', async () => {
		const socket = makeSocket(true)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		expect(await promise).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the connection is not authorized', async () => {
		const socket = makeSocket(false)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		expect(await promise).toBe(false)
	})

	it('resolves false on socket error', async () => {
		const socket = makeSocket()
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('error')

		expect(await promise).toBe(false)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false on socket timeout event', async () => {
		const socket = makeSocket()
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('timeout')

		expect(await promise).toBe(false)
	})

	it('ignores subsequent events after settlement', async () => {
		const socket = makeSocket(true)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		socket.emit('error')

		expect(await promise).toBe(true)
	})

	it('resolves false when the built-in timeout fires', async () => {
		vi.useFakeTimers()
		const socket = makeSocket()
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com', 100)
		vi.runAllTimers()
		vi.useRealTimers()

		expect(await promise).toBe(false)
	})

	it('connects with the given hostname and port 443', () => {
		const socket = makeSocket()
		mockConnect.mockReturnValue(socket as never)

		hasValidCertificate('my-host.example.com')
		socket.emit('error')

		expect(mockConnect).toHaveBeenCalledWith(
			expect.objectContaining({
				host: 'my-host.example.com',
				port: 443,
				servername: 'my-host.example.com',
				rejectUnauthorized: true
			})
		)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS is not resolved', async () => {
		expect(await resolveSslStatus('example.com', false)).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when the certificate is valid', async () => {
		const socket = makeSocket(true)
		mockConnect.mockReturnValue(socket as never)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await promise).toBe('active')
	})

	it('returns provisioning when certificate check fails', async () => {
		const socket = makeSocket()
		mockConnect.mockReturnValue(socket as never)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('error')

		expect(await promise).toBe('provisioning')
	})
})
