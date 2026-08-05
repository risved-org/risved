import { describe, it, expect, vi } from 'vitest';
import { repairDomainRoute } from './repair';

const { createCaddyClient } = vi.hoisted(() => ({
	createCaddyClient: vi.fn()
}));

vi.mock('./index', () => ({ createCaddyClient }));

describe('repairDomainRoute', () => {
	it('re-adds the route and redirect for a bare hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true });
		createCaddyClient.mockReturnValue({ addRoute, addRedirectRoute });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.com', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.com', 'app.example.com');
	});

	it('skips the redirect route for a www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn();
		createCaddyClient.mockReturnValue({ addRoute, addRedirectRoute });

		const result = await repairDomainRoute('www.example.com', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the main route fails to add', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false });
		const addRedirectRoute = vi.fn();
		createCaddyClient.mockReturnValue({ addRoute, addRedirectRoute });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect route fails to add', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false });
		createCaddyClient.mockReturnValue({ addRoute, addRedirectRoute });

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the caddy client throws', async () => {
		createCaddyClient.mockImplementation(() => {
			throw new Error('connection refused');
		});

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});
});
