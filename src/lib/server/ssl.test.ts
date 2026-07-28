import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

class FakeSocket extends EventEmitter {
	destroy = vi.fn()
	authorized = true
}

let fakeSocket: FakeSocket

vi.mock('node:tls', () => ({
	connect: vi.fn(() => fakeSocket)
}))

import { connect } from 'node:tls'
import { hasValidCertificate, resolveSslStatus } from './ssl'

const mockConnect = vi.mocked(connect)

describe('hasValidCertificate', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		fakeSocket = new FakeSocket()
	})

	it('resolves true for a trusted certificate', async () => {
		const promise = hasValidCertificate('example.com')
		fakeSocket.emit('secureConnect')
		await expect(promise).resolves.toBe(true)
		expect(mockConnect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'example.com', port: 443, servername: 'example.com' })
		)
	})

	it('resolves false when the certificate is untrusted', async () => {
		Object.assign(fakeSocket, { authorized: false })
		const promise = hasValidCertificate('example.com')
		fakeSocket.emit('secureConnect')
		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com')
		fakeSocket.emit('error', new Error('refused'))
		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on timeout event', async () => {
		const promise = hasValidCertificate('example.com')
		fakeSocket.emit('timeout')
		await expect(promise).resolves.toBe(false)
	})

	it('destroys the socket once settled', async () => {
		const promise = hasValidCertificate('example.com')
		fakeSocket.emit('secureConnect')
		await promise
		expect(fakeSocket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		fakeSocket = new FakeSocket()
	})

	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false)
		expect(status).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and certificate is valid', async () => {
		const promise = resolveSslStatus('example.com', true)
		fakeSocket.emit('secureConnect')
		await expect(promise).resolves.toBe('active')
	})

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const promise = resolveSslStatus('example.com', true)
		fakeSocket.emit('error', new Error('refused'))
		await expect(promise).resolves.toBe('provisioning')
	})
})
