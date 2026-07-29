import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairDomainRoute } from './repair';

const { createCaddyClientMock, addRouteMock, addRedirectRouteMock } = vi.hoisted(() => {
	const addRouteMock = vi.fn();
	const addRedirectRouteMock = vi.fn();
	const createCaddyClientMock = vi.fn(() => ({
		addRoute: addRouteMock,
		addRedirectRoute: addRedirectRouteMock
	}));
	return { createCaddyClientMock, addRouteMock, addRedirectRouteMock };
});

vi.mock('./index', () => ({
	createCaddyClient: createCaddyClientMock
}));

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('adds a redirect route after re-adding a non-www hostname', async () => {
		addRouteMock.mockResolvedValue({ success: true });
		addRedirectRouteMock.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(addRouteMock).toHaveBeenCalledWith({ hostname: 'app.example.com', port: 3001 });
		expect(addRedirectRouteMock).toHaveBeenCalledWith('www.app.example.com', 'app.example.com');
		expect(result).toBe(true);
	});

	it('does not add a redirect route for a www hostname', async () => {
		addRouteMock.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.app.example.com', 3001);

		expect(addRedirectRouteMock).not.toHaveBeenCalled();
		expect(result).toBe(true);
	});

	it('returns false when the base route fails to be added', async () => {
		addRouteMock.mockResolvedValue({ success: false, error: 'boom' });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(addRedirectRouteMock).not.toHaveBeenCalled();
		expect(result).toBe(false);
	});

	it('returns false when the redirect route fails to be added', async () => {
		addRouteMock.mockResolvedValue({ success: true });
		addRedirectRouteMock.mockResolvedValue({ success: false, error: 'boom' });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the caddy client throws', async () => {
		addRouteMock.mockRejectedValue(new Error('network error'));

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});
});
