import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCaddyClient = {
	addRoute: vi.fn(),
	addRedirectRoute: vi.fn()
};

vi.mock('./index', () => ({
	createCaddyClient: () => mockCaddyClient
}));

import { repairDomainRoute } from './repair';

describe('repairDomainRoute', () => {
	beforeEach(() => {
		mockCaddyClient.addRoute.mockReset();
		mockCaddyClient.addRedirectRoute.mockReset();
	});

	it('returns false when the initial route add fails', async () => {
		mockCaddyClient.addRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
		expect(mockCaddyClient.addRedirectRoute).not.toHaveBeenCalled();
	});

	it('adds a www redirect and returns its success for non-www hostnames', async () => {
		mockCaddyClient.addRoute.mockResolvedValue({ success: true });
		mockCaddyClient.addRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('example.com', 3000);

		expect(mockCaddyClient.addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com');
		expect(result).toBe(true);
	});

	it('propagates a failed redirect add for non-www hostnames', async () => {
		mockCaddyClient.addRoute.mockResolvedValue({ success: true });
		mockCaddyClient.addRedirectRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});

	it('skips the redirect route for www hostnames', async () => {
		mockCaddyClient.addRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.example.com', 3000);

		expect(mockCaddyClient.addRedirectRoute).not.toHaveBeenCalled();
		expect(result).toBe(true);
	});

	it('returns false when the caddy client throws', async () => {
		mockCaddyClient.addRoute.mockRejectedValue(new Error('caddy unreachable'));

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});
});
