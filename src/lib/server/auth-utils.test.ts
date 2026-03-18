import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn()
	}
}));

import { db } from '$lib/server/db';
import { isFirstRun, getUserCount } from './auth-utils';

function mockUserCount(total: number) {
	const mockFrom = vi.fn().mockResolvedValue([{ total }]);
	const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
	vi.mocked(db.select).mockImplementation(mockSelect);
}

describe('auth-utils', () => {
	describe('isFirstRun', () => {
		it('returns true when no users exist', async () => {
			mockUserCount(0);
			expect(await isFirstRun()).toBe(true);
		});

		it('returns false when an admin user exists', async () => {
			mockUserCount(1);
			expect(await isFirstRun()).toBe(false);
		});

		it('returns false when multiple users exist', async () => {
			mockUserCount(3);
			expect(await isFirstRun()).toBe(false);
		});
	});

	describe('getUserCount', () => {
		it('returns 0 when no users exist', async () => {
			mockUserCount(0);
			expect(await getUserCount()).toBe(0);
		});

		it('returns the actual user count', async () => {
			mockUserCount(5);
			expect(await getUserCount()).toBe(5);
		});
	});
});

describe('auth configuration', () => {
	it('requires 8 character minimum password', async () => {
		const mod = await import('./auth.ts?raw');
		expect(mod.default).toContain('minPasswordLength: 8');
	});

	it('does not include social providers', async () => {
		const mod = await import('./auth.ts?raw');
		expect(mod.default).not.toContain('socialProviders');
		expect(mod.default).not.toContain('GITHUB_CLIENT_ID');
	});

	it('enables email and password with autoSignIn', async () => {
		const mod = await import('./auth.ts?raw');
		expect(mod.default).toContain('enabled: true');
		expect(mod.default).toContain('autoSignIn: true');
	});
});

describe('hooks middleware', () => {
	it('configures public paths for onboarding, login, and auth API', async () => {
		const mod = await import('../../hooks.server.ts?raw');
		const src = mod.default;
		expect(src).toContain("'/onboarding'");
		expect(src).toContain("'/login'");
		expect(src).toContain("'/api/auth'");
	});

	it('redirects to onboarding on first run', async () => {
		const mod = await import('../../hooks.server.ts?raw');
		expect(mod.default).toContain("redirect(303, '/onboarding')");
	});

	it('redirects unauthenticated users to login', async () => {
		const mod = await import('../../hooks.server.ts?raw');
		expect(mod.default).toContain("redirect(303, '/login')");
	});

	it('blocks onboarding after setup is complete', async () => {
		const mod = await import('../../hooks.server.ts?raw');
		expect(mod.default).toContain("pathname.startsWith('/onboarding')");
	});
});
