import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairDomainRoute } from './repair';

const { addRoute, addRedirectRoute } = vi.hoisted(() => ({
	addRoute: vi.fn(),
	addRedirectRoute: vi.fn()
}));

vi.mock('./index', () => ({
	createCaddyClient: () => ({ addRoute, addRedirectRoute })
}));

describe('repairDomainRoute', () => {
	beforeEach(() => {
		addRoute.mockReset();
		addRedirectRoute.mockReset();
	});

	it('returns false when adding the route fails', async () => {
		addRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('adds a www redirect and succeeds for a non-www hostname', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.com', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.com', 'app.example.com');
	});

	it('returns false when the www redirect fails', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});

	it('skips the www redirect for hostnames already prefixed with www', async () => {
		addRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.app.example.com', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the client throws', async () => {
		addRoute.mockRejectedValue(new Error('connection refused'));

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});
});
