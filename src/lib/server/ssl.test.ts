import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:tls', () => ({
	connect: vi.fn()
}))

import { connect } from 'node:tls'
import { hasValidCertificate, resolveSslStatus } from './ssl'

const mockConnect = vi.mocked(connect)

beforeEach(() => {
	vi.clearAllMocks()
})

function fakeSocket(authorized: boolean) {
	const socket = new EventEmitter() as EventEmitter & { authorized: boolean, destroy: ReturnType<typeof vi.fn> }
	socket.authorized = authorized
	socket.destroy = vi.fn()
	return socket
}

describe('hasValidCertificate', () => {
	it('resolves true when the socket presents a trusted certificate', async () => {
		const socket = fakeSocket(true)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the socket presents an untrusted certificate', async () => {
		const socket = fakeSocket(false)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false when the socket errors', async () => {
		const socket = fakeSocket(false)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('econnrefused'))

		await expect(promise).resolves.toBe(false)
	})

	it('resolves false when the connection times out', async () => {
		vi.useFakeTimers()
		try {
			const socket = fakeSocket(false)
			mockConnect.mockReturnValue(socket as never)

			const promise = hasValidCertificate('example.com', 50)
			vi.advanceTimersByTime(50)

			await expect(promise).resolves.toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it('only settles once when multiple events fire', async () => {
		const socket = fakeSocket(true)
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com')
		socket.emit('secureConnect')
		socket.emit('error', new Error('late error'))

		await expect(promise).resolves.toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when dns has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false)

		expect(status).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when dns resolved and the certificate is valid', async () => {
		const socket = fakeSocket(true)
		mockConnect.mockReturnValue(socket as never)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('secureConnect')

		await expect(promise).resolves.toBe('active')
	})

	it('returns provisioning when dns resolved but the certificate is invalid', async () => {
		const socket = fakeSocket(false)
		mockConnect.mockReturnValue(socket as never)

		const promise = resolveSslStatus('example.com', true)
		socket.emit('error')

		await expect(promise).resolves.toBe('provisioning')
	})
})
