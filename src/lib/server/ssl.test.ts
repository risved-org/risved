import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const connectMock = vi.fn()

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connectMock(...args)
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
		connectMock.mockReset()
		connectMock.mockReturnValue(socket)
	})

	it('resolves true when the socket presents a trusted certificate', async () => {
		const promise = hasValidCertificate('example.com')
		socket.authorized = true
		socket.emit('secureConnect')
		await expect(promise).resolves.toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})

	it('resolves false when the socket certificate is not authorized', async () => {
		const promise = hasValidCertificate('example.com')
		socket.authorized = false
		socket.emit('secureConnect')
		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com')
		socket.emit('error', new Error('boom'))
		await expect(promise).resolves.toBe(false)
	})

	it('resolves false on socket timeout event', async () => {
		const promise = hasValidCertificate('example.com')
		socket.emit('timeout')
		await expect(promise).resolves.toBe(false)
	})

	it('resolves false after the timeout elapses with no response', async () => {
		vi.useFakeTimers()
		try {
			const promise = hasValidCertificate('example.com', 10)
			await vi.advanceTimersByTimeAsync(10)
			await expect(promise).resolves.toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it('only settles once even if multiple events fire', async () => {
		const promise = hasValidCertificate('example.com')
		socket.authorized = true
		socket.emit('secureConnect')
		socket.emit('error', new Error('late'))
		await expect(promise).resolves.toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})

	it('connects with the expected host, port, and servername', async () => {
		const promise = hasValidCertificate('example.com')
		socket.authorized = true
		socket.emit('secureConnect')
		await promise
		expect(connectMock).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		})
	})
})

describe('resolveSslStatus', () => {
	beforeEach(() => {
		connectMock.mockReset()
	})

	it('returns pending when dns has not resolved yet', async () => {
		const status = await resolveSslStatus('example.com', false)
		expect(status).toBe('pending')
		expect(connectMock).not.toHaveBeenCalled()
	})

	it('returns active when dns resolved and certificate is valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connectMock.mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'))
			return socket
		})
		const status = await resolveSslStatus('example.com', true)
		expect(status).toBe('active')
	})

	it('returns provisioning when dns resolved but certificate is invalid', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		connectMock.mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'))
			return socket
		})
		const status = await resolveSslStatus('example.com', true)
		expect(status).toBe('provisioning')
	})
})
