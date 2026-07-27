import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { hasValidCertificate, resolveSslStatus } from './ssl';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('node:tls', () => ({ connect }));

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

	it('resolves true when the certificate is authorized', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the certificate is not authorized', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = false;
		socket.emit('secureConnect');

		expect(await promise).toBe(false);
	});

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('ECONNREFUSED'));

		expect(await promise).toBe(false);
	});

	it('resolves false on socket timeout', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		expect(await promise).toBe(false);
	});

	it('resolves false when the connection attempt times out', async () => {
		vi.useFakeTimers();
		const promise = hasValidCertificate('example.com', 1000);
		vi.advanceTimersByTime(1000);

		expect(await promise).toBe(false);
		vi.useRealTimers();
	});

	it('only settles once even if multiple events fire', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	let socket: FakeSocket;

	beforeEach(() => {
		socket = new FakeSocket();
		connect.mockReset();
		connect.mockReturnValue(socket);
	});

	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false);
		expect(status).toBe('pending');
		expect(connect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and certificate is valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		socket.authorized = true;
		socket.emit('secureConnect');

		expect(await promise).toBe('active');
	});

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const promise = resolveSslStatus('example.com', true);
		socket.authorized = false;
		socket.emit('secureConnect');

		expect(await promise).toBe('provisioning');
	});
});
