import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:tls', () => ({
	connect: vi.fn()
}));

import { connect } from 'node:tls';
import { hasValidCertificate, resolveSslStatus } from './ssl';

const mockConnect = vi.mocked(connect);

beforeEach(() => {
	vi.clearAllMocks();
});

function mockSocket() {
	const socket = new EventEmitter() as EventEmitter & {
		destroy: ReturnType<typeof vi.fn>;
		authorized?: boolean;
	};
	socket.destroy = vi.fn();
	return socket;
}

describe('hasValidCertificate', () => {
	it('resolves true when the certificate is authorized', async () => {
		const socket = mockSocket();
		socket.authorized = true;
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the certificate is not authorized', async () => {
		const socket = mockSocket();
		socket.authorized = false;
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket error', async () => {
		const socket = mockSocket();
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('connection refused'));

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket timeout event', async () => {
		const socket = mockSocket();
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		await expect(promise).resolves.toBe(false);
	});

	it('only settles once when multiple events fire', async () => {
		const socket = mockSocket();
		socket.authorized = true;
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late error'));

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	it('returns pending when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false);
		expect(status).toBe('pending');
		expect(mockConnect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and certificate is valid', async () => {
		const socket = mockSocket();
		socket.authorized = true;
		mockConnect.mockReturnValue(socket as never);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		await expect(promise).resolves.toBe('active');
	});

	it('returns provisioning when DNS resolved but certificate is invalid', async () => {
		const socket = mockSocket();
		mockConnect.mockReturnValue(socket as never);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('error', new Error('cert not ready'));

		await expect(promise).resolves.toBe('provisioning');
	});
});
