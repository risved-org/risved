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

beforeEach(() => {
	vi.clearAllMocks()
})

describe('hasValidCertificate', () => {
	it('resolves true when the socket presents an authorized certificate', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(true)
		expect(connect).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		})
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the socket certificate is not authorized', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		connect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on socket error', async () => {
		const socket = new FakeSocket()
		connect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('connection refused'))

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on timeout', async () => {
		const socket = new FakeSocket()
		connect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('timeout')

		await expect(promise).resolves.toBe(false)
	})

	it('ignores events after settling', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connect.mockReturnValue(socket)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		socket.emit('error', new Error('late error'))

		await expect(promise).resolves.toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false)
		expect(status).toBe('pending')
		expect(connect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and certificate is valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connect.mockReturnValue(socket)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe('active')
	})

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const socket = new FakeSocket()
		connect.mockReturnValue(socket)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('error', new Error('no cert'))

		await expect(promise).resolves.toBe('provisioning')
	})
})
