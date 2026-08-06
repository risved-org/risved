import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

const connect = vi.fn()

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connect(...args)
}))

class FakeSocket extends EventEmitter {
	authorized = false
	destroy = vi.fn()
}

describe('hasValidCertificate', () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it('resolves true for a trusted, authorized certificate', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connect.mockReturnValue(socket)

		const { hasValidCertificate } = await import('./ssl')
		const promise = hasValidCertificate('good.risved.example.eu')
		socket.emit('secureConnect')

		expect(await promise).toBe(true)
		expect(socket.destroy).toHaveBeenCalled()
	})

	it('resolves false when the certificate is not authorized', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		connect.mockReturnValue(socket)

		const { hasValidCertificate } = await import('./ssl')
		const promise = hasValidCertificate('untrusted.risved.example.eu')
		socket.emit('secureConnect')

		expect(await promise).toBe(false)
	})

	it('resolves false on a connection error', async () => {
		const socket = new FakeSocket()
		connect.mockReturnValue(socket)

		const { hasValidCertificate } = await import('./ssl')
		const promise = hasValidCertificate('down.risved.example.eu')
		socket.emit('error', new Error('connection refused'))

		expect(await promise).toBe(false)
	})

	it('resolves false when the connection times out', async () => {
		vi.useFakeTimers()
		const socket = new FakeSocket()
		connect.mockReturnValue(socket)

		const { hasValidCertificate } = await import('./ssl')
		const promise = hasValidCertificate('slow.risved.example.eu', 1000)
		vi.advanceTimersByTime(1000)

		expect(await promise).toBe(false)
		vi.useRealTimers()
	})
})

describe('resolveSslStatus', () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it('returns pending when DNS has not resolved yet', async () => {
		const { resolveSslStatus } = await import('./ssl')

		const status = await resolveSslStatus('app.risved.example.eu', false)

		expect(status).toBe('pending')
		expect(connect).not.toHaveBeenCalled()
	})

	it('returns active once DNS resolves and the certificate is valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = true
		connect.mockReturnValue(socket)

		const { resolveSslStatus } = await import('./ssl')
		const promise = resolveSslStatus('app.risved.example.eu', true)
		socket.emit('secureConnect')

		expect(await promise).toBe('active')
	})

	it('returns provisioning when DNS resolves but the certificate is not yet valid', async () => {
		const socket = new FakeSocket()
		socket.authorized = false
		connect.mockReturnValue(socket)

		const { resolveSslStatus } = await import('./ssl')
		const promise = resolveSslStatus('app.risved.example.eu', true)
		socket.emit('secureConnect')

		expect(await promise).toBe('provisioning')
	})
})
