import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockConnect = vi.fn()

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => mockConnect(...args)
}))

const { hasValidCertificate, resolveSslStatus } = await import('./ssl')

class MockSocket extends EventEmitter {
	authorized = false
	destroy = vi.fn()
}

describe('hasValidCertificate', () => {
	beforeEach(() => {
		mockConnect.mockReset()
	})

	it('resolves true when the socket completes with an authorized certificate', async () => {
		const socket = new MockSocket()
		socket.authorized = true
		mockConnect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the socket completes with an unauthorized certificate', async () => {
		const socket = new MockSocket()
		socket.authorized = false
		mockConnect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on socket error', async () => {
		const socket = new MockSocket()
		mockConnect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('connection refused'))

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on socket timeout event', async () => {
		const socket = new MockSocket()
		mockConnect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('timeout')

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false when the timeout elapses without a connection', async () => {
		vi.useFakeTimers()
		const socket = new MockSocket()
		mockConnect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com', 50)
		vi.advanceTimersByTime(50)

		await expect(promise).resolves.toBe(false)
		vi.useRealTimers()
	})

	it('ignores events after the promise has already settled', async () => {
		const socket = new MockSocket()
		mockConnect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('first'))
		socket.authorized = true
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(false)
	})
})

describe('resolveSslStatus', () => {
	beforeEach(() => {
		mockConnect.mockReset()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('returns pending when DNS has not resolved yet', async () => {
		const result = await resolveSslStatus('example.com', false)
		expect(result).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const socket = new MockSocket()
		socket.authorized = true
		mockConnect.mockReturnValue(socket)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe('active')
	})

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		const socket = new MockSocket()
		socket.authorized = false
		mockConnect.mockReturnValue(socket)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe('provisioning')
	})
})
