import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (...args: unknown[]) => void;

class MockSocket {
	handlers: Record<string, Handler> = {};
	destroy = vi.fn();
	authorized = false;

	once(event: string, cb: Handler) {
		this.handlers[event] = cb;
		return this;
	}

	emit(event: string, ...args: unknown[]) {
		this.handlers[event]?.(...args);
	}
}

let mockSocket: MockSocket;
const mockConnect = vi.fn();

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => mockConnect(...args)
}));

import { hasValidCertificate, resolveSslStatus } from './ssl';

describe('hasValidCertificate', () => {
	beforeEach(() => {
		mockSocket = new MockSocket();
		mockConnect.mockReset();
		mockConnect.mockReturnValue(mockSocket);
	});

	it('resolves true when the server presents an authorized certificate', async () => {
		const promise = hasValidCertificate('example.com');
		mockSocket.authorized = true;
		mockSocket.emit('secureConnect');

		expect(await promise).toBe(true);
		expect(mockConnect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'example.com', port: 443, servername: 'example.com', rejectUnauthorized: true })
		);
		expect(mockSocket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the certificate is not authorized', async () => {
		const promise = hasValidCertificate('example.com');
		mockSocket.authorized = false;
		mockSocket.emit('secureConnect');

		expect(await promise).toBe(false);
	});

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com');
		mockSocket.emit('error', new Error('ECONNREFUSED'));

		expect(await promise).toBe(false);
	});

	it('resolves false on socket timeout event', async () => {
		const promise = hasValidCertificate('example.com');
		mockSocket.emit('timeout');

		expect(await promise).toBe(false);
	});

	it('resolves false after the timeout elapses with no response', async () => {
		vi.useFakeTimers();
		try {
			const promise = hasValidCertificate('example.com', 50);
			await vi.advanceTimersByTimeAsync(50);

			expect(await promise).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ignores late events once already settled', async () => {
		const promise = hasValidCertificate('example.com');
		mockSocket.emit('error', new Error('first'));
		mockSocket.authorized = true;
		mockSocket.emit('secureConnect');

		expect(await promise).toBe(false);
		expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		mockSocket = new MockSocket();
		mockConnect.mockReset();
		mockConnect.mockReturnValue(mockSocket);
	});

	it('returns pending when DNS has not resolved yet', async () => {
		const result = await resolveSslStatus('example.com', false);

		expect(result).toBe('pending');
		expect(mockConnect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		mockSocket.authorized = true;
		mockSocket.emit('secureConnect');

		expect(await promise).toBe('active');
	});

	it('returns provisioning when DNS resolved but the certificate is not yet valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		mockSocket.emit('error', new Error('cert not ready'));

		expect(await promise).toBe('provisioning');
	});
});
