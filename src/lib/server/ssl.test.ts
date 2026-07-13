import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const connect = vi.fn()

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connect(...args)
}))

import { hasValidCertificate, resolveSslStatus } from './ssl'

class FakeSocket extends EventEmitter {
	authorized = false
	destroy = vi.fn()
}

describe('hasValidCertificate', () => {
	let socket: FakeSocket

	beforeEach(() => {
		socket = new FakeSocket()
		connect.mockReset()
		connect.mockReturnValue(socket)
	})

	it('resolves true when the socket presents a trusted certificate', async () => {
		socket.authorized = true
		const promise = hasValidCertificate('example.com')

		socket.emit('secureConnect')

		expect(await promise).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the certificate is not authorized', async () => {
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

	it('resolves false after the timeout elapses with no response', async () => {
		vi.useFakeTimers()
		try {
			const promise = hasValidCertificate('example.com', 1000)
			vi.advanceTimersByTime(1000)

			expect(await promise).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('resolveSslStatus', () => {
	beforeEach(() => {
		connect.mockReset()
	})

	it('returns pending when DNS has not resolved yet', async () => {
		const result = await resolveSslStatus('example.com', false)

		expect(result).toBe('pending')
		expect(connect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connect.mockReturnValue(socket)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await promise).toBe('active')
	})

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		connect.mockReturnValue(socket)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await promise).toBe('provisioning')
	})
})
