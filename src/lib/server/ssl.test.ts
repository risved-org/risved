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

function mockConnect(): FakeSocket {
	const socket = new FakeSocket();
	vi.mocked(connect).mockReturnValue(socket as never);
	return socket;
}

describe('hasValidCertificate', () => {
	beforeEach(() => {
		vi.mocked(connect).mockReset();
	});

	it('resolves true when the socket reports an authorized secure connection', async () => {
		const socket = mockConnect();
		socket.authorized = true;

		const resultPromise = hasValidCertificate('example.eu');
		socket.emit('secureConnect');

		expect(await resultPromise).toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket is not authorized', async () => {
		const socket = mockConnect();
		socket.authorized = false;

		const resultPromise = hasValidCertificate('example.eu');
		socket.emit('secureConnect');

		expect(await resultPromise).toBe(false);
	});

	it('resolves false on socket error', async () => {
		const socket = mockConnect();

		const resultPromise = hasValidCertificate('example.eu');
		socket.emit('error', new Error('connection refused'));

		expect(await resultPromise).toBe(false);
	});

	it('resolves false on timeout event', async () => {
		const socket = mockConnect();

		const resultPromise = hasValidCertificate('example.eu');
		socket.emit('timeout');

		expect(await resultPromise).toBe(false);
	});

	it('only settles once when multiple events fire', async () => {
		const socket = mockConnect();
		socket.authorized = true;

		const resultPromise = hasValidCertificate('example.eu');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		expect(await resultPromise).toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		vi.mocked(connect).mockReset();
	});

	it('returns pending when DNS has not resolved', async () => {
		const result = await resolveSslStatus('example.eu', false);
		expect(result).toBe('pending');
		expect(connect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const socket = mockConnect();
		socket.authorized = true;

		const resultPromise = resolveSslStatus('example.eu', true);
		socket.emit('secureConnect');

		expect(await resultPromise).toBe('active');
	});

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		const socket = mockConnect();
		socket.authorized = false;

		const resultPromise = resolveSslStatus('example.eu', true);
		socket.emit('secureConnect');

		expect(await resultPromise).toBe('provisioning');
	});
});
