import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const connectMock = vi.fn();

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connectMock(...args)
}));

import { hasValidCertificate, resolveSslStatus } from './ssl';

class FakeSocket extends EventEmitter {
	authorized = false;
	destroy = vi.fn();
}

describe('hasValidCertificate', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('resolves true when the socket reports a trusted certificate', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		connectMock.mockReturnValue(socket);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(true);
		expect(connectMock).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		});
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket reports an untrusted certificate', async () => {
		const socket = new FakeSocket();
		socket.authorized = false;
		connectMock.mockReturnValue(socket);

		const promise = hasValidCertificate('bad.example.com');
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket error', async () => {
		const socket = new FakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('connection refused'));

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on timeout', async () => {
		vi.useFakeTimers();
		const socket = new FakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = hasValidCertificate('example.com', 1000);
		vi.advanceTimersByTime(1000);

		await expect(promise).resolves.toBe(false);
		vi.useRealTimers();
	});

	it('only settles once even if multiple events fire', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		connectMock.mockReturnValue(socket);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false);
		expect(status).toBe('pending');
		expect(connectMock).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and certificate is valid', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		connectMock.mockReturnValue(socket);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe('active');
	});

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const socket = new FakeSocket();
		socket.authorized = false;
		connectMock.mockReturnValue(socket);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe('provisioning');
	});
});
