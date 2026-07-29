import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

class FakeSocket extends EventEmitter {
	authorized = false
	destroy = vi.fn()
}

let fakeSocket: FakeSocket

const connect = vi.fn(() => fakeSocket)

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connect(...args)
}))

import { hasValidCertificate, resolveSslStatus } from './ssl'

beforeEach(() => {
	connect.mockClear()
})

describe('hasValidCertificate', () => {
	it('resolves true when the socket presents a trusted certificate', async () => {
		fakeSocket = new FakeSocket()
		fakeSocket.authorized = true

		const promise = hasValidCertificate('example.eu')
		fakeSocket.emit('secureConnect')

		expect(await promise).toBe(true)
		expect(connect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'example.eu', port: 443, servername: 'example.eu' })
		)
	})

	it('resolves false when the certificate is not authorized', async () => {
		fakeSocket = new FakeSocket()
		fakeSocket.authorized = false

		const promise = hasValidCertificate('example.eu')
		fakeSocket.emit('secureConnect')

		expect(await promise).toBe(false)
	})

	it('resolves false on socket error', async () => {
		fakeSocket = new FakeSocket()

		const promise = hasValidCertificate('example.eu')
		fakeSocket.emit('error', new Error('connection refused'))

		expect(await promise).toBe(false)
	})

	it('resolves false on socket timeout', async () => {
		fakeSocket = new FakeSocket()

		const promise = hasValidCertificate('example.eu')
		fakeSocket.emit('timeout')

		expect(await promise).toBe(false)
	})

	it('ignores events after settling', async () => {
		fakeSocket = new FakeSocket()
		fakeSocket.authorized = true

		const promise = hasValidCertificate('example.eu')
		fakeSocket.emit('secureConnect')
		fakeSocket.emit('error', new Error('late error'))

		expect(await promise).toBe(true)
		expect(fakeSocket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		expect(await resolveSslStatus('example.eu', false)).toBe('pending')
		expect(connect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and the certificate is valid', async () => {
		fakeSocket = new FakeSocket()
		fakeSocket.authorized = true

		const promise = resolveSslStatus('example.eu', true)
		fakeSocket.emit('secureConnect')

		expect(await promise).toBe('active')
	})

	it('returns provisioning when DNS resolved but the certificate is not yet valid', async () => {
		fakeSocket = new FakeSocket()

		const promise = resolveSslStatus('example.eu', true)
		fakeSocket.emit('error', new Error('not ready'))

		expect(await promise).toBe('provisioning')
	})
})
