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

	it('adds route and www redirect for a non-www hostname', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true });
		vi.mocked(createCaddyClient).mockReturnValue({
			addRoute,
			addRedirectRoute
		} as unknown as ReturnType<typeof createCaddyClient>);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(true);
		expect(addRoute).toHaveBeenCalledWith({ hostname: 'app.example.eu', port: 3001 });
		expect(addRedirectRoute).toHaveBeenCalledWith('www.app.example.eu', 'app.example.eu');
	});

	it('skips the www redirect when hostname already starts with www', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn();
		vi.mocked(createCaddyClient).mockReturnValue({
			addRoute,
			addRedirectRoute
		} as unknown as ReturnType<typeof createCaddyClient>);

		const result = await repairDomainRoute('www.app.example.eu', 3001);

		expect(result).toBe(true);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the route fails to add', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: false });
		const addRedirectRoute = vi.fn();
		vi.mocked(createCaddyClient).mockReturnValue({
			addRoute,
			addRedirectRoute
		} as unknown as ReturnType<typeof createCaddyClient>);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
		expect(addRedirectRoute).not.toHaveBeenCalled();
	});

	it('returns false when the redirect route fails to add', async () => {
		const addRoute = vi.fn().mockResolvedValue({ success: true });
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: false });
		vi.mocked(createCaddyClient).mockReturnValue({
			addRoute,
			addRedirectRoute
		} as unknown as ReturnType<typeof createCaddyClient>);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});

	it('returns false when createCaddyClient throws', async () => {
		vi.mocked(createCaddyClient).mockImplementation(() => {
			throw new Error('config missing');
		});

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});

	it('returns false when addRoute rejects', async () => {
		const addRoute = vi.fn().mockRejectedValue(new Error('network error'));
		vi.mocked(createCaddyClient).mockReturnValue({
			addRoute,
			addRedirectRoute: vi.fn()
		} as unknown as ReturnType<typeof createCaddyClient>);

		const result = await repairDomainRoute('app.example.eu', 3001);

		expect(result).toBe(false);
	});
});
