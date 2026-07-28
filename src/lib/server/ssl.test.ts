import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { connect } from 'node:tls';
import { hasValidCertificate, resolveSslStatus } from './ssl';

vi.mock('node:tls', () => ({
	connect: vi.fn()
}));

class FakeSocket extends EventEmitter {
	authorized = false;
	destroy = vi.fn();
}

describe('hasValidCertificate', () => {
	let socket: FakeSocket;

	beforeEach(() => {
		socket = new FakeSocket();
		vi.mocked(connect).mockReturnValue(socket as never);
	});

	it('resolves true when the socket presents a trusted certificate', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket certificate is not authorized', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = false;
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('boom'));

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket timeout event', async () => {
		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false when the timeout elapses with no response', async () => {
		vi.useFakeTimers();
		const promise = hasValidCertificate('example.com', 1000);
		vi.advanceTimersByTime(1000);

		await expect(promise).resolves.toBe(false);
		vi.useRealTimers();
	});

	it('only settles once when multiple events fire', async () => {
		const promise = hasValidCertificate('example.com');
		socket.authorized = true;
		socket.emit('secureConnect');
		socket.emit('error', new Error('late'));

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		vi.mocked(connect).mockReset();
	});

	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false);

		expect(status).toBe('pending');
		expect(connect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		vi.mocked(connect).mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'));
			return socket as never;
		});

		const status = await resolveSslStatus('example.com', true);

		expect(status).toBe('active');
	});

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		const socket = new FakeSocket();
		socket.authorized = false;
		vi.mocked(connect).mockImplementation(() => {
			queueMicrotask(() => socket.emit('secureConnect'));
			return socket as never;
		});

		const status = await resolveSslStatus('example.com', true);

		expect(status).toBe('provisioning');
	});
});
