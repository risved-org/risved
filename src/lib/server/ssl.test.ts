import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:tls', () => ({
	connect: vi.fn()
}));

import { connect } from 'node:tls';
import { hasValidCertificate, resolveSslStatus } from './ssl';

const mockConnect = vi.mocked(connect);

function createFakeSocket(authorized = true) {
	const socket = Object.assign(new EventEmitter(), {
		authorized,
		destroy: vi.fn()
	});
	return socket;
}

describe('hasValidCertificate', () => {
	beforeEach(() => {
		mockConnect.mockReset();
	});

	it('resolves true when the socket reports an authorized certificate', async () => {
		const socket = createFakeSocket(true);
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket reports an unauthorized certificate', async () => {
		const socket = createFakeSocket(false);
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');

		expect(await promise).toBe(false);
	});

	it('resolves false when the socket errors', async () => {
		const socket = createFakeSocket(true);
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('error', new Error('connection refused'));

		expect(await promise).toBe(false);
	});

	it('resolves false when the socket times out', async () => {
		const socket = createFakeSocket(true);
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('timeout');

		expect(await promise).toBe(false);
	});

	it('ignores events received after the first settle', async () => {
		const socket = createFakeSocket(true);
		mockConnect.mockReturnValue(socket as never);

		const promise = hasValidCertificate('example.com');
		socket.emit('secureConnect');
		socket.emit('error', new Error('late'));

		expect(await promise).toBe(true);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		mockConnect.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns pending without checking the certificate when DNS has not resolved', async () => {
		const status = await resolveSslStatus('example.com', false);

		expect(status).toBe('pending');
		expect(mockConnect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const socket = createFakeSocket(true);
		mockConnect.mockReturnValue(socket as never);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		expect(await promise).toBe('active');
	});

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		const socket = createFakeSocket(false);
		mockConnect.mockReturnValue(socket as never);

		const promise = resolveSslStatus('example.com', true);
		socket.emit('secureConnect');

		expect(await promise).toBe('provisioning');
	});
});
