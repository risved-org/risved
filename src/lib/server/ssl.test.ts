import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const connect = vi.fn();

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connect(...args)
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

	it('resolves true when the socket authorizes', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		connect.mockReturnValue(socket);

		const result = hasValidCertificate('example.eu');
		socket.emit('secureConnect');

		await expect(result).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket is not authorized', async () => {
		const socket = new FakeSocket();
		socket.authorized = false;
		connect.mockReturnValue(socket);

		const result = hasValidCertificate('example.eu');
		socket.emit('secureConnect');

		await expect(result).resolves.toBe(false);
	});

	it('resolves false on a socket error', async () => {
		const socket = new FakeSocket();
		connect.mockReturnValue(socket);

		const result = hasValidCertificate('example.eu');
		socket.emit('error', new Error('refused'));

		await expect(result).resolves.toBe(false);
	});

	it('resolves false on a socket timeout event', async () => {
		const socket = new FakeSocket();
		connect.mockReturnValue(socket);

		const result = hasValidCertificate('example.eu');
		socket.emit('timeout');

		await expect(result).resolves.toBe(false);
	});

	it('does not settle twice when multiple events fire', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		connect.mockReturnValue(socket);

		const result = hasValidCertificate('example.eu');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late'));

		await expect(result).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns pending without checking the certificate when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.eu', false);

		expect(status).toBe('pending');
		expect(connect).not.toHaveBeenCalled();
	});

	it('returns active when the certificate is valid', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		connect.mockReturnValue(socket);

		const resultPromise = resolveSslStatus('example.eu', true);
		socket.emit('secureConnect');

		await expect(resultPromise).resolves.toBe('active');
	});

	it('returns provisioning when the certificate is not yet valid', async () => {
		const socket = new FakeSocket();
		connect.mockReturnValue(socket);

		const resultPromise = resolveSslStatus('example.eu', true);
		socket.emit('error', new Error('not ready'));

		await expect(resultPromise).resolves.toBe('provisioning');
	});
});
