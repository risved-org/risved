import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAddRoute = vi.fn();
const mockAddRedirectRoute = vi.fn();
const mockCreateCaddyClient = vi.fn(() => ({
	addRoute: mockAddRoute,
	addRedirectRoute: mockAddRedirectRoute
}));

vi.mock('./index', () => ({
	createCaddyClient: () => mockCreateCaddyClient()
}));

import { repairDomainRoute } from './repair';

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('re-adds the route and adds a www redirect for a bare hostname', async () => {
		mockAddRoute.mockResolvedValue({ success: true });
		mockAddRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('example.com', 3001);

		expect(result).toBe(true);
		expect(mockAddRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3001 });
		expect(mockAddRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com');
	});

	it('skips the www redirect for a hostname that already has a www prefix', async () => {
		mockAddRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.example.com', 3001);

		expect(result).toBe(true);
		expect(mockAddRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the route cannot be added', async () => {
		mockAddRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('example.com', 3001);

		expect(result).toBe(false);
		expect(mockAddRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect route fails', async () => {
		mockAddRoute.mockResolvedValue({ success: true });
		mockAddRedirectRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('example.com', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the client throws', async () => {
		mockAddRoute.mockRejectedValue(new Error('connection refused'));

		const result = await repairDomainRoute('example.com', 3001);

		expect(result).toBe(false);
	});
});
