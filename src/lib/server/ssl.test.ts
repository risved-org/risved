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
	beforeEach(() => {
		vi.mocked(connect).mockReset();
	});

	it('resolves true when the socket presents a trusted certificate', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the certificate is not authorized', async () => {
		const socket = new FakeSocket();
		socket.authorized = false;
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		expect(await promise).toBe(false);
	});

	it('resolves false on socket error', async () => {
		const socket = new FakeSocket();
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('ECONNREFUSED'));

		expect(await promise).toBe(false);
	});

	it('resolves false on timeout', async () => {
		vi.useFakeTimers();
		const socket = new FakeSocket();
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com', 1000);
		vi.advanceTimersByTime(1000);

		expect(await promise).toBe(false);
		vi.useRealTimers();
	});

	it('only settles once when multiple events fire', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		expect(await promise).toBe(true);
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

	it('returns active when DNS resolved and certificate is valid', async () => {
		const socket = new FakeSocket();
		socket.authorized = true;
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		expect(await promise).toBe('active');
	});

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const socket = new FakeSocket();
		socket.authorized = false;
		vi.mocked(connect).mockReturnValue(socket as never);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		expect(await promise).toBe('provisioning');
	});
});
