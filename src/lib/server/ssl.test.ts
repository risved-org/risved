import { describe, it, expect, vi, beforeEach } from 'vitest';
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
	let socket: FakeSocket;

	beforeEach(() => {
		socket = new FakeSocket();
		connectMock.mockReset();
		connectMock.mockReturnValue(socket);
	});

	it('resolves true when the socket presents a trusted certificate', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket is not authorized', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = false;
		socket.emit('secureConnect');

		expect(await promise).toBe(false);
	});

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('boom'));

		expect(await promise).toBe(false);
	});

	it('resolves false on timeout event', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		expect(await promise).toBe(false);
	});

	it('only settles once even if multiple events fire', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');
		socket.emit('error', new Error('late'));

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	let socket: FakeSocket;

	beforeEach(() => {
		socket = new FakeSocket();
		connectMock.mockReset();
		connectMock.mockReturnValue(socket);
	});

	it('returns pending when DNS has not resolved', async () => {
		const result = await resolveSslStatus('example.com', false);
		expect(result).toBe('pending');
		expect(connectMock).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and certificate is valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		socket.authorized = true;
		socket.emit('secureConnect');

		expect(await promise).toBe('active');
	});

	it('returns provisioning when DNS resolved but certificate is not yet valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		socket.emit('error', new Error('boom'));

		expect(await promise).toBe('provisioning');
	});
});
