import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
	const updateMock = vi.fn(() => ({ set: setMock }));
	const selectMock = vi.fn(() => ({ from: vi.fn().mockResolvedValue([]) }));
	return { db: { update: updateMock, select: selectMock, __setMock: setMock } };
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	user: 'user_table',
	gitConnections: 'git_connections_table'
}));

vi.mock('$lib/server/update', () => ({
	getUpdateChecker: () => ({ getCachedUpdateInfo: vi.fn().mockResolvedValue({}) })
}));

vi.mock('$lib/server/census', () => ({
	getCensusReporter: () => ({ getInfo: vi.fn().mockResolvedValue(null) })
}));

vi.mock('$lib/server/heartbeat', () => ({
	getHeartbeatReporter: () => ({ getInfo: vi.fn().mockResolvedValue(null), setEnabled: vi.fn() })
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null),
	setSetting: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			changePassword: vi.fn().mockResolvedValue({})
		}
	}
}));

import { getSetting, setSetting } from '$lib/server/settings';
import { load, actions } from '../(dashboard)/settings/+page.server';

describe('settings load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns null user when not authenticated', async () => {
		const result = (await load({
			locals: { user: null }
		} as unknown as Parameters<typeof load>[0])) as {
			user: null;
		};

		expect(result.user).toBeNull();
	});

	it('returns user data and settings when authenticated', async () => {
		(getSetting as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce('risved.example.com') // hostname
			.mockResolvedValueOnce('America/New_York') // timezone
			.mockResolvedValueOnce(null) // api_token
			.mockResolvedValueOnce(null); // log_retention_days

		const result = (await load({
			locals: { user: { id: 'u-1', email: 'admin@test.com', name: 'Admin' } }
		} as unknown as Parameters<typeof load>[0])) as {
			user: { id: string; email: string };
			hostname: string;
			timezone: string;
			apiToken: string | null;
		};

		expect(result.user?.email).toBe('admin@test.com');
		expect(result.hostname).toBe('risved.example.com');
		expect(result.timezone).toBe('America/New_York');
		expect(result.apiToken).toBeNull();
	});

	it('masks API token in load', async () => {
		(getSetting as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('rsv_abcdef1234567890abcdef1234567890')
			.mockResolvedValueOnce(null); // log_retention_days

		const result = (await load({
			locals: { user: { id: 'u-1', email: 'admin@test.com', name: 'Admin' } }
		} as unknown as Parameters<typeof load>[0])) as {
			apiToken: string | null;
		};

		expect(result.apiToken).toContain('rsv_abcd');
		expect(result.apiToken).toContain('••••');
		expect(result.apiToken).not.toBe('rsv_abcdef1234567890abcdef1234567890');
	});
});

describe('settings actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('general saves hostname and timezone', async () => {
		const formData = new FormData();
		formData.set('hostname', 'risved.example.com');
		formData.set('timezone', 'Europe/Berlin');

		const result = await actions.general({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.general>[0]);

		expect(result).toMatchObject({ generalSaved: true });
		expect(setSetting).toHaveBeenCalledWith('hostname', 'risved.example.com');
		expect(setSetting).toHaveBeenCalledWith('timezone', 'Europe/Berlin');
	});

	it('email returns error for invalid email', async () => {
		const formData = new FormData();
		formData.set('email', 'not-an-email');

		const result = await actions.email({
			request: { formData: () => Promise.resolve(formData) },
			locals: { user: { id: 'u-1' } }
		} as unknown as Parameters<typeof actions.email>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('password returns error for short password', async () => {
		const formData = new FormData();
		formData.set('currentPassword', 'oldpass12345x');
		formData.set('newPassword', 'short');
		formData.set('confirmPassword', 'short');

		const result = await actions.password({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.password>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('password returns error for mismatched passwords', async () => {
		const formData = new FormData();
		formData.set('currentPassword', 'oldpass12345x');
		formData.set('newPassword', 'newpass12345abc');
		formData.set('confirmPassword', 'different12345x');

		const result = await actions.password({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.password>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('generateToken creates a token with rsv_ prefix', async () => {
		const result = (await actions.generateToken(
			{} as unknown as Parameters<typeof actions.generateToken>[0]
		)) as { tokenGenerated: boolean; newToken: string };

		expect(result.tokenGenerated).toBe(true);
		expect(result.newToken).toMatch(/^rsv_[a-f0-9]{64}$/);
		expect(setSetting).toHaveBeenCalledWith('api_token', result.newToken);
	});

	it('revokeToken clears the token', async () => {
		const result = await actions.revokeToken(
			{} as unknown as Parameters<typeof actions.revokeToken>[0]
		);

		expect(result).toMatchObject({ tokenRevoked: true });
		expect(setSetting).toHaveBeenCalledWith('api_token', '');
	});
});

describe('settings page source', () => {
	it('has general section', async () => {
		const mod = await import('../(dashboard)/settings/+page.svelte?raw');
		expect(mod.default).toContain('general-section');
	});

	it('has email section', async () => {
		const mod = await import('../(dashboard)/settings/+page.svelte?raw');
		expect(mod.default).toContain('email-section');
	});

	it('has password section', async () => {
		const mod = await import('../(dashboard)/settings/+page.svelte?raw');
		expect(mod.default).toContain('password-section');
	});

	it('has token section', async () => {
		const mod = await import('../(dashboard)/settings/+page.svelte?raw');
		expect(mod.default).toContain('token-section');
	});

	it('has hostname input', async () => {
		const mod = await import('../(dashboard)/settings/+page.svelte?raw');
		expect(mod.default).toContain('hostname-input');
	});

	it('has timezone select', async () => {
		const mod = await import('../(dashboard)/settings/+page.svelte?raw');
		expect(mod.default).toContain('timezone-select');
	});
});
