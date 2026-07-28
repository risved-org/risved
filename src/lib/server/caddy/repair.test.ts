import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairDomainRoute } from './repair';
import { createCaddyClient } from './index';

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}));

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('re-applies the route and adds a www redirect for a non-www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true });
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.com', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.com', 'app.example.com');
	});

	it('skips the redirect route for a www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn();
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('www.example.com', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the initial route fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false });
		const addRedirectRoute = vi.fn();
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect route fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false });
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the client throws', async () => {
		vi.mocked(createCaddyClient).mockImplementation(() => {
			throw new Error('connection refused');
		});

		const result = await repairDomainRoute('app.example.com', 3001);

		expect(result).toBe(false);
	});
});
