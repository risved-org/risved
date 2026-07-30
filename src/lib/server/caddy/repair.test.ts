import { describe, it, expect, vi, beforeEach } from 'vitest';

const addRoute = vi.fn();
const addRedirectRoute = vi.fn();

vi.mock('./index', () => ({
	createCaddyClient: vi.fn(() => ({
		addRoute,
		addRedirectRoute
	}))
}));

import { repairDomainRoute } from './repair';

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('re-adds the route and adds a www redirect for a non-www hostname', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.eu', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.eu', 'app.example.eu');
	});

	it('skips the redirect for a www hostname', async () => {
		addRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.app.example.eu', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the route fails to be added', async () => {
		addRoute.mockResolvedValue({ success: false, error: 'boom' });

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect route fails to be added', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: false, error: 'boom' });

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the client throws', async () => {
		addRoute.mockRejectedValue(new Error('network error'));

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});
});
