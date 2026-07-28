import { describe, it, expect, vi, afterEach } from 'vitest';

const addRoute = vi.fn();
const addRedirectRoute = vi.fn();
const createCaddyClient = vi.fn(() => ({ addRoute, addRedirectRoute }));

vi.mock('./index', () => ({
	createCaddyClient: () => createCaddyClient()
}));

import { repairDomainRoute } from './repair';

describe('repairDomainRoute', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns false when adding the route fails', async () => {
		addRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('adds a www redirect and succeeds for a non-www hostname', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'example.com', port: 3000 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com');
	});

	it('returns false when the www redirect fails', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});

	it('skips the www redirect for hostnames already starting with www', async () => {
		addRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.example.com', 3000);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the client throws', async () => {
		addRoute.mockRejectedValue(new Error('network error'));

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});
});
