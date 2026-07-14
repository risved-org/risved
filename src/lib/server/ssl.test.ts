import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:tls', () => ({
	connect: vi.fn()
}))

import { connect } from 'node:tls'
import { hasValidCertificate, resolveSslStatus } from './ssl'

const mockConnect = vi.mocked(connect)

function createFakeSocket() {
	const socket = new EventEmitter() as EventEmitter & {
		destroy: ReturnType<typeof vi.fn>
		authorized?: boolean
	}
	socket.destroy = vi.fn()
	return socket
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('hasValidCertificate', () => {
	it('resolves true when the socket reports a trusted certificate', async () => {
		const socket = createFakeSocket()
		socket.authorized = true
		mockConnect.mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'))
			return socket as never
		})

		const result = await hasValidCertificate('example.com')

		expect(result).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
		expect(mockConnect).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		})
	})

	it('resolves false when the certificate is not authorized', async () => {
		const socket = createFakeSocket()
		socket.authorized = false
		mockConnect.mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'))
			return socket as never
		})

		const result = await hasValidCertificate('example.com')

		expect(result).toBe(false)
	})

	it('resolves false on a socket error', async () => {
		const socket = createFakeSocket()
		mockConnect.mockImplementation(() => {
			queueMicrotask(() => socket.emit('error', new Error('refused')))
			return socket as never
		})

		const result = await hasValidCertificate('example.com')

		expect(result).toBe(false)
	})

	it('resolves false when the connection times out', async () => {
		vi.useFakeTimers()
		const socket = createFakeSocket()
		mockConnect.mockReturnValue(socket as never)

		const promise = hasValidCertificate('example.com', 50)
		await vi.advanceTimersByTimeAsync(50)

		expect(await promise).toBe(false)
		expect(socket.destroy).toHaveBeenCalled()
		vi.useRealTimers()
	})

	it('only settles once even if multiple events fire', async () => {
		const socket = createFakeSocket()
		socket.authorized = true
		mockConnect.mockImplementation(() => {
			queueMicrotask(() => {
				socket.emit('secureConnect')
				socket.emit('error', new Error('late'))
			})
			return socket as never
		})

		const result = await hasValidCertificate('example.com')

		expect(result).toBe(true)
		expect(socket.destroy).toHaveBeenCalledTimes(1)
	})
})

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		const result = await resolveSslStatus('example.com', false)

		expect(result).toBe('pending')
		expect(mockConnect).not.toHaveBeenCalled()
	})

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const socket = createFakeSocket()
		socket.authorized = true
		mockConnect.mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'))
			return socket as never
		})

		const result = await resolveSslStatus('example.com', true)

		expect(result).toBe('active')
	})

	it('returns provisioning when DNS resolved but no valid certificate yet', async () => {
		const socket = createFakeSocket()
		mockConnect.mockImplementation(() => {
			queueMicrotask(() => socket.emit('error', new Error('refused')))
			return socket as never
		})

		const result = await resolveSslStatus('example.com', true)

		expect(result).toBe('provisioning')
	})
})
