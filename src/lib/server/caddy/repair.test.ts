import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairDomainRoute } from './repair';
import { createCaddyClient } from './index';

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}));

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.mocked(createCaddyClient).mockReset();
	});

	it('re-adds the route and the www redirect for a bare hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true });
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.eu', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.eu', 'app.example.eu');
	});

	it('skips the redirect when the hostname already starts with www.', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn();
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('www.app.example.eu', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the route add fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false });
		const addRedirectRoute = vi.fn();
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect add fails', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false });
		vi.mocked(createCaddyClient).mockReturnValue({ addRoute, addRedirectRoute } as never);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});

	it('returns false when the client throws', async () => {
		vi.mocked(createCaddyClient).mockImplementation(() => {
			throw new Error('boom');
		});

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});
});
