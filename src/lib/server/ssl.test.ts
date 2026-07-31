import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

afterEach(() => {
	vi.useRealTimers()
})

describe('hasValidCertificate', () => {
	it('resolves true when the socket presents a trusted certificate', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		expect(await resultPromise).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the socket is not authorized', async () => {
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
		socket.emit('error', new Error('refused'))

		expect(await resultPromise).toBe(false)
	})

	it('resolves false when the timeout elapses', async () => {
		vi.useFakeTimers()
		const socket = new FakeSocket()
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com', 1000)
		vi.advanceTimersByTime(1000)

		expect(await resultPromise).toBe(false)
	})

	it('ignores late events once settled', async () => {
		const socket = new FakeSocket()
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = hasValidCertificate('example.com')
		socket.emit('error', new Error('refused'))
		socket.authorized = true
		socket.emit('secureConnect')

		expect(await resultPromise).toBe(false)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		expect(await resolveSslStatus('example.com', false)).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when the certificate is valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await resultPromise).toBe('active')
	})

	it('returns provisioning when the certificate is not yet valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		mockConnect.mockReturnValue(socket as never)

		const resultPromise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		expect(await resultPromise).toBe('provisioning')
	})
})
