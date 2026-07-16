import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:tls', () => ({
	connect: vi.fn()
}))

import { connect } from 'node:tls'
import { hasValidCertificate, resolveSslStatus } from './ssl'

const mockConnect = vi.mocked(connect)

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
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		expect(await resultPromise).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the socket certificate is not authorized', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		expect(await resultPromise).toBe(false)
	})

	it('resolves false on socket error', async () => {
		const socket = new FakeSocket()
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('error', new Error('ECONNREFUSED'))

		expect(await resultPromise).toBe(false)
	})

	it('resolves false on socket timeout event', async () => {
		const socket = new FakeSocket()
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('timeout')

		expect(await resultPromise).toBe(false)
	})

	it('only settles once when multiple events fire', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		socket.emit('error', new Error('late error'))

		expect(await resultPromise).toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})

	it('connects with the given hostname on port 443', async () => {
		const socket = new FakeSocket()
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('error', new Error('fail'))
		await resultPromise

		expect(mockConnect).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		})
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		const result = await resolveSslStatus('example.com', false)
		expect(result).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and certificate is valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await resultPromise).toBe('active')
	})

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await resultPromise).toBe('provisioning')
	})
})
