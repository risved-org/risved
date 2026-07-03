import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { hasValidCertificate, resolveSslStatus } from './ssl';

const { connectMock } = vi.hoisted(() => {
	return { connectMock: vi.fn() };
});

vi.mock('node:tls', () => ({
	connect: connectMock
}));

class FakeSocket extends EventEmitter {
	authorized = false;
	destroy = vi.fn();
}

describe('hasValidCertificate', () => {
	let socket: FakeSocket;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		socket = new FakeSocket();
		connectMock.mockReturnValue(socket);
	});

	it('resolves true when the socket reports an authorized secure connection', async () => {
		socket.authorized = true;
		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket reports an unauthorized secure connection', async () => {
		socket.authorized = false;
		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false when the socket errors', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('connection refused'));

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false when the socket times out', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		await expect(promise).resolves.toBe(false);
	});

	it('settles only once when multiple events fire', async () => {
		socket.authorized = true;
		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectMock.mockImplementation(() => {
			const socket = new FakeSocket();
			queueMicrotask(() => {
				socket.authorized = true;
				socket.emit('secureConnect');
			});
			return socket;
		});
	});

	it('returns pending when DNS has not resolved', async () => {
		const result = await resolveSslStatus('app.example.com', false);
		expect(result).toBe('pending');
		expect(connectMock).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const result = await resolveSslStatus('app.example.com', true);
		expect(result).toBe('active');
	});

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		connectMock.mockImplementation(() => {
			const socket = new FakeSocket();
			queueMicrotask(() => socket.emit('error', new Error('no cert')));
			return socket;
		});

		const result = await resolveSslStatus('app.example.com', true);
		expect(result).toBe('provisioning');
	});
});
