import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { connect } = vi.hoisted(() => ({
	connect: vi.fn()
}));

vi.mock('node:tls', () => ({ connect }));

import { hasValidCertificate, resolveSslStatus } from './ssl';

class FakeSocket extends EventEmitter {
	authorized = false;
	destroy = vi.fn();
}

describe('hasValidCertificate', () => {
	let socket: FakeSocket;

	beforeEach(() => {
		socket = new FakeSocket();
		connect.mockReturnValue(socket);
	});

	it('resolves true when the socket presents an authorized certificate', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the certificate is not authorized', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = false;
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('ECONNREFUSED'));

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket timeout event', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		await expect(promise).resolves.toBe(false);
	});

	it('only settles once when multiple events fire', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});

	it('connects with the expected TLS options', () => {
		void hasValidCertificate('example.com', 1234);

		expect(connect).toHaveBeenCalledWith({
			host: 'example.com',
			port: 443,
			servername: 'example.com',
			rejectUnauthorized: true
		});
		socket.emit('error', new Error('cleanup'));
	});
});

describe('resolveSslStatus', () => {
	let socket: FakeSocket;

	beforeEach(() => {
		socket = new FakeSocket();
		connect.mockClear();
		connect.mockReturnValue(socket);
	});

	it('returns pending when DNS has not resolved', async () => {
		const result = await resolveSslStatus('example.com', false);
		expect(result).toBe('pending');
		expect(connect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and certificate is valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		socket.authorized = true;
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe('active');
	});

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const promise = resolveSslStatus('example.com', true);
		socket.authorized = false;
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe('provisioning');
	});
});
