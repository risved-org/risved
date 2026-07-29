import { describe, it, expect, vi, beforeEach } from 'vitest';

const addRoute = vi.fn();
const addRedirectRoute = vi.fn();
const createCaddyClient = vi.fn(() => ({ addRoute, addRedirectRoute }));

vi.mock('./index', () => ({
	createCaddyClient: (...args: unknown[]) => createCaddyClient(...args)
}));

import { repairDomainRoute } from './repair';

describe('repairDomainRoute', () => {
	beforeEach(() => {
		addRoute.mockReset();
		addRedirectRoute.mockReset();
	});

	it('returns false when the base route fails to add', async () => {
		addRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('adds a www redirect and returns its result for a non-www hostname', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.com', 'app.example.com');
	});

	it('returns false when the www redirect fails', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});

	it('skips the redirect and returns true for a www hostname', async () => {
		addRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.app.example.com', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the client throws', async () => {
		addRoute.mockRejectedValue(new Error('network error'));

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});
});
