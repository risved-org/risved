import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairDomainRoute } from './repair';
import { createCaddyClient } from './index';

vi.mock('./index', () => ({
	createCaddyClient: vi.fn()
}));

const mockCreateCaddyClient = vi.mocked(createCaddyClient);

describe('repairDomainRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns false when the primary route fails to apply', async () => {
		mockCreateCaddyClient.mockReturnValue({
			addRoute: vi.fn().mockResolvedValue({ success: false }),
			addRedirectRoute: vi.fn()
		} as any);

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});

	it('adds a www redirect route and returns its success for non-www hostnames', async () => {
		const addRedirectRoute = vi.fn().mockResolvedValue({ success: true });
		mockCreateCaddyClient.mockReturnValue({
			addRoute: vi.fn().mockResolvedValue({ success: true }),
			addRedirectRoute
		} as any);

		const result = await repairDomainRoute('example.com', 3000);

		expect(addRedirectRoute).toHaveBeenCalledWith('www.example.com', 'example.com');
		expect(result).toBe(true);
	});

	it('propagates failure from the www redirect route', async () => {
		mockCreateCaddyClient.mockReturnValue({
			addRoute: vi.fn().mockResolvedValue({ success: true }),
			addRedirectRoute: vi.fn().mockResolvedValue({ success: false })
		} as any);

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});

	it('skips the redirect route when hostname already starts with www', async () => {
		const addRedirectRoute = vi.fn();
		mockCreateCaddyClient.mockReturnValue({
			addRoute: vi.fn().mockResolvedValue({ success: true }),
			addRedirectRoute
		} as any);

		const result = await repairDomainRoute('www.example.com', 3000);

		expect(addRedirectRoute).not.toHaveBeenCalled();
		expect(result).toBe(true);
	});

	it('returns false when the caddy client throws', async () => {
		mockCreateCaddyClient.mockImplementation(() => {
			throw new Error('connection refused');
		});

		const result = await repairDomainRoute('example.com', 3000);

		expect(result).toBe(false);
	});
});
