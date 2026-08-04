import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

describe('hasValidCertificate', () => {
	let socket: FakeSocket

	beforeEach(() => {
		socket = new FakeSocket()
		mockConnect.mockReset()
		mockConnect.mockReturnValue(socket)
	})

	it('connects with the expected TLS options', () => {
		hasValidCertificate('example.com')
		expect(mockConnect).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		})
	})

	it('resolves true when secureConnect fires on an authorized socket', async () => {
		socket.authorized = true
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		expect(await promise).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when secureConnect fires on an unauthorized socket', async () => {
		socket.authorized = false
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		expect(await promise).toBe(false)
	})

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('connection refused'))
		expect(await promise).toBe(false)
	})

	it('resolves false on socket timeout event', async () => {
		const promise = hasValidCertificate('example.com')
		socket.emit('timeout')
		expect(await promise).toBe(false)
	})

	it('ignores events after the promise has already settled', async () => {
		socket.authorized = true
		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		expect(await promise).toBe(true)
		expect(() => socket.emit('error', new Error('late'))).not.toThrow()
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})

	describe('with fake timers', () => {
		beforeEach(() => vi.useFakeTimers())
		afterEach(() => vi.useRealTimers())

		it('resolves false once the timeout elapses without a response', async () => {
			const promise = hasValidCertificate('example.com', 1000)
			await vi.advanceTimersByTimeAsync(1000)
			expect(await promise).toBe(false)
		})
	})
})

describe('resolveSslStatus', () => {
	let socket: FakeSocket

	beforeEach(() => {
		socket = new FakeSocket()
		mockConnect.mockReset()
		mockConnect.mockReturnValue(socket)
	})

	it('returns pending without checking the certificate when DNS has not resolved', async () => {
		const result = await resolveSslStatus('example.com', false)
		expect(result).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and the certificate is valid', async () => {
		socket.authorized = true
		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')
		expect(await promise).toBe('active')
	})

	it('returns provisioning when DNS resolved but the certificate is not yet valid', async () => {
		socket.authorized = false
		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')
		expect(await promise).toBe('provisioning')
	})
})
