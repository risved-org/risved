import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

class FakeSocket extends EventEmitter {
	authorized = false;
	destroy = vi.fn();
}

let fakeSocket: FakeSocket;
const connectMock = vi.fn();

vi.mock('node:tls', () => ({
	connect: (...args: unknown[]) => connectMock(...args)
}));

import { hasValidCertificate, resolveSslStatus } from './ssl';

describe('hasValidCertificate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fakeSocket = new FakeSocket();
		connectMock.mockReset();
		connectMock.mockImplementation(() => fakeSocket);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves true when the socket presents a trusted certificate', async () => {
		const promise = hasValidCertificate('example.com');
		fakeSocket.authorized = true;
		fakeSocket.emit('secureConnect');

		await expect(promise).resolves.toBe(true);
		expect(fakeSocket.destroy).toHaveBeenCalledTimes(1);
	});

	it('resolves false when the certificate is not authorized', async () => {
		const promise = hasValidCertificate('example.com');
		fakeSocket.authorized = false;
		fakeSocket.emit('secureConnect');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket error', async () => {
		const promise = hasValidCertificate('example.com');
		fakeSocket.emit('error', new Error('econnrefused'));

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on socket timeout event', async () => {
		const promise = hasValidCertificate('example.com');
		fakeSocket.emit('timeout');

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false when no event fires before the timeout elapses', async () => {
		const promise = hasValidCertificate('example.com', 1000);
		vi.advanceTimersByTime(1000);

		await expect(promise).resolves.toBe(false);
		expect(fakeSocket.destroy).toHaveBeenCalledTimes(1);
	});

	it('only settles once when multiple events fire', async () => {
		const promise = hasValidCertificate('example.com');
		fakeSocket.authorized = true;
		fakeSocket.emit('secureConnect');
		fakeSocket.emit('error', new Error('late error'));

		await expect(promise).resolves.toBe(true);
		expect(fakeSocket.destroy).toHaveBeenCalledTimes(1);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fakeSocket = new FakeSocket();
		connectMock.mockReset();
		connectMock.mockImplementation(() => fakeSocket);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns pending without checking the certificate when DNS is unresolved', async () => {
		const result = await resolveSslStatus('example.com', false);

		expect(result).toBe('pending');
		expect(connectMock).not.toHaveBeenCalled();
	});

	it('returns active when DNS is resolved and the certificate is valid', async () => {
		const promise = resolveSslStatus('example.com', true);
		fakeSocket.authorized = true;
		fakeSocket.emit('secureConnect');

		await expect(promise).resolves.toBe('active');
	});

	it('returns provisioning when DNS is resolved but the certificate is invalid', async () => {
		const promise = resolveSslStatus('example.com', true);
		fakeSocket.emit('error', new Error('econnrefused'));

		await expect(promise).resolves.toBe('provisioning');
	});
});
