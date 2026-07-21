import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairDomainRoute } from './repair';
import { createCaddyClient } from './index';

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}));

describe('repairDomainRoute', () => {
	const addRoute = vi.fn();
	const addRedirectRoute = vi.fn();

	beforeEach(() => {
		vi.mocked(createCaddyClient).mockReturnValue({
			addRoute,
			addRedirectRoute
		} as unknown as ReturnType<typeof createCaddyClient>);
		addRoute.mockReset();
		addRedirectRoute.mockReset();
	});

	it('re-applies the route and adds a www redirect for a bare hostname', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('myapp.example.com', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'myapp.example.com', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.myapp.example.com', 'myapp.example.com');
	});

	it('skips the redirect for a hostname that already has a www prefix', async () => {
		addRoute.mockResolvedValue({ success: true });

		const result = await repairDomainRoute('www.myapp.example.com', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the route fails to apply', async () => {
		addRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('myapp.example.com', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect fails to apply', async () => {
		addRoute.mockResolvedValue({ success: true });
		addRedirectRoute.mockResolvedValue({ success: false });

		const result = await repairDomainRoute('myapp.example.com', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the caddy client throws', async () => {
		addRoute.mockRejectedValue(new Error('network error'));

		const result = await repairDomainRoute('myapp.example.com', 3001);

		expect(result).toBe(false);
	});
});
