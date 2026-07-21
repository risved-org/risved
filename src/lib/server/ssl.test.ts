import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connect } from 'node:tls';
import { hasValidCertificate, resolveSslStatus } from './ssl';

vi.mock('node:tls', () => ({
	connect: vi.fn()
}));

type Handlers = Record<string, () => void>;

function mockSocket() {
	const handlers: Handlers = {};
	const socket = {
		once: vi.fn((event: string, cb: () => void) => {
			handlers[event] = cb;
		}),
		destroy: vi.fn(),
		authorized: true
	};
	vi.mocked(connect).mockReturnValue(socket as never);
	return { socket, handlers };
}

describe('hasValidCertificate', () => {
	beforeEach(() => {
		vi.mocked(connect).mockReset();
	});

	it('resolves true when the socket presents a trusted certificate', async () => {
		const { socket, handlers } = mockSocket();
		socket.authorized = true;

		const promise = hasValidCertificate('example.com');
		handlers.secureConnect();

		await expect(promise).resolves.toBe(true);
		expect(socket.destroy).toHaveBeenCalled();
	});

	it('resolves false when the socket certificate is not authorized', async () => {
		const { socket, handlers } = mockSocket();
		socket.authorized = false;

		const promise = hasValidCertificate('example.com');
		handlers.secureConnect();

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on a connection error', async () => {
		const { handlers } = mockSocket();

		const promise = hasValidCertificate('example.com');
		handlers.error();

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false on a socket timeout event', async () => {
		const { handlers } = mockSocket();

		const promise = hasValidCertificate('example.com');
		handlers.timeout();

		await expect(promise).resolves.toBe(false);
	});

	it('ignores further events once settled', async () => {
		const { socket, handlers } = mockSocket();
		socket.authorized = true;

		const promise = hasValidCertificate('example.com');
		handlers.secureConnect();
		handlers.error();

		await expect(promise).resolves.toBe(true);
	});
});

describe('resolveSslStatus', () => {
	beforeEach(() => {
		vi.mocked(connect).mockReset();
	});

	it('returns pending when DNS has not resolved yet', async () => {
		const result = await resolveSslStatus('example.com', false);

		expect(result).toBe('pending');
		expect(connect).not.toHaveBeenCalled();
	});

	it('returns active when DNS resolved and the certificate is valid', async () => {
		const { socket, handlers } = mockSocket();
		socket.authorized = true;

		const promise = resolveSslStatus('example.com', true);
		handlers.secureConnect();

		await expect(promise).resolves.toBe('active');
	});

	it('returns provisioning when DNS resolved but the certificate is invalid', async () => {
		const { handlers } = mockSocket();

		const promise = resolveSslStatus('example.com', true);
		handlers.error();

		await expect(promise).resolves.toBe('provisioning');
	});
});
