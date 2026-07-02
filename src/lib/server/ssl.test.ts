import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockConnect = vi.fn()

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => mockConnect(...args)
}))

const { hasValidCertificate, resolveSslStatus } = await import('./ssl')

class FakeSocket extends EventEmitter {
	authorized = false
	destroy = vi.fn()
}

let socket: FakeSocket

beforeEach(() => {
	socket = new FakeSocket()
	mockConnect.mockReset()
	mockConnect.mockReturnValue(socket)
})

describe('hasValidCertificate', () => {
	it('resolves true when the certificate is trusted', async () => {
		socket.authorized = true
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		expect(await promise).toBe(true)
	})

	it('resolves false when the certificate is not trusted', async () => {
		socket.authorized = false
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		expect(await promise).toBe(false)
	})

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('boom'))
		expect(await promise).toBe(false)
	})

	it('resolves false on timeout', async () => {
		vi.useFakeTimers()
		try {
			const promise = hasValidCertificate('example.com', 100)
			vi.advanceTimersByTime(100)
			expect(await promise).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it('destroys the socket after settling', async () => {
		socket.authorized = true
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		await promise
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('ignores events after the socket has already settled', async () => {
		socket.authorized = true
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		socket.emit('error', new Error('late'))
		expect(await promise).toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		expect(await resolveSslStatus('example.com', false)).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when the certificate is valid', async () => {
		socket.authorized = true
		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')
		expect(await promise).toBe('active')
	})

	it('returns provisioning when the certificate is not valid', async () => {
		socket.authorized = false
		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')
		expect(await promise).toBe('provisioning')
	})
})
