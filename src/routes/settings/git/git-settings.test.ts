import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const mockConnections = [
		{
			id: 'c-1',
			provider: 'github',
			accountName: 'octocat',
			instanceUrl: null,
			avatarUrl: 'https://avatars.githubusercontent.com/u/1',
			createdAt: '2026-01-15T00:00:00.000Z'
		},
		{
			id: 'c-2',
			provider: 'forgejo',
			accountName: 'forge-user',
			instanceUrl: 'https://codeberg.org',
			avatarUrl: null,
			createdAt: '2026-02-20T00:00:00.000Z'
		}
	];
	const selectFn = vi.fn(() => ({ from: vi.fn(() => mockConnections) }));
	const deleteFn = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
	const setFn = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
	const updateFn = vi.fn(() => ({ set: setFn }));
	return { db: { select: selectFn, delete: deleteFn, update: updateFn } };
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: {
		id: 'id',
		provider: 'provider',
		accountName: 'account_name',
		instanceUrl: 'instance_url',
		avatarUrl: 'avatar_url',
		createdAt: 'created_at'
	}
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null),
	setSetting: vi.fn().mockResolvedValue(undefined)
}));

import { getSetting, setSetting } from '$lib/server/settings';
import { load, actions } from './+page.server';

describe('git settings load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty connections when not authenticated', async () => {
		const result = (await load({
			locals: { user: null }
		} as unknown as Parameters<typeof load>[0])) as {
			connections: unknown[];
		};

		expect(result.connections).toEqual([]);
	});

	it('returns connections with enriched instance URLs', async () => {
		(getSetting as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(null) // ssh key
			.mockResolvedValueOnce(null) // auto_webhook
			.mockResolvedValueOnce(null) // commit_status
			.mockResolvedValueOnce(null); // deploy_previews

		const result = (await load({
			locals: { user: { id: 'u-1' } }
		} as unknown as Parameters<typeof load>[0])) as {
			connections: Array<{ provider: string; instanceUrl: string | null }>;
		};

		expect(result.connections).toHaveLength(2);
		expect(result.connections[0].instanceUrl).toBe('https://github.com');
		expect(result.connections[1].instanceUrl).toBe('https://codeberg.org');
	});

	it('returns SSH public key when generated', async () => {
		(getSetting as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce('ssh-ed25519 AAAA... risved-deploy-key')
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);

		const result = (await load({
			locals: { user: { id: 'u-1' } }
		} as unknown as Parameters<typeof load>[0])) as {
			sshPublicKey: string | null;
		};

		expect(result.sshPublicKey).toBe('ssh-ed25519 AAAA... risved-deploy-key');
	});

	it('returns default webhook settings', async () => {
		(getSetting as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(null) // ssh key
			.mockResolvedValueOnce('true') // auto_webhook
			.mockResolvedValueOnce('false') // commit_status
			.mockResolvedValueOnce('true'); // deploy_previews

		const result = (await load({
			locals: { user: { id: 'u-1' } }
		} as unknown as Parameters<typeof load>[0])) as {
			defaults: { autoWebhook: boolean; commitStatus: boolean; deployPreviews: boolean };
		};

		expect(result.defaults.autoWebhook).toBe(true);
		expect(result.defaults.commitStatus).toBe(false);
		expect(result.defaults.deployPreviews).toBe(true);
	});
});

describe('git settings actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('disconnect removes connection by ID', async () => {
		const formData = new FormData();
		formData.set('connectionId', 'c-1');

		const result = await actions.disconnect({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.disconnect>[0]);

		expect(result).toMatchObject({ disconnected: true });
	});

	it('disconnect returns error without connectionId', async () => {
		const formData = new FormData();

		const result = await actions.disconnect({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.disconnect>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('refresh updates timestamp', async () => {
		const formData = new FormData();
		formData.set('connectionId', 'c-1');

		const result = await actions.refresh({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.refresh>[0]);

		expect(result).toMatchObject({ refreshed: true, connectionId: 'c-1' });
	});

	it('refresh returns error without connectionId', async () => {
		const formData = new FormData();

		const result = await actions.refresh({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.refresh>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('saveDefaults persists webhook settings', async () => {
		const formData = new FormData();
		formData.set('autoWebhook', 'on');
		formData.set('commitStatus', 'on');

		const result = await actions.saveDefaults({
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.saveDefaults>[0]);

		expect(result).toMatchObject({ defaultsSaved: true });
		expect(setSetting).toHaveBeenCalledWith('git_auto_webhook', 'true');
		expect(setSetting).toHaveBeenCalledWith('git_commit_status', 'true');
		expect(setSetting).toHaveBeenCalledWith('git_deploy_previews', 'false');
	});
});

describe('git settings page source', () => {
	it('has accounts list', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('accounts-list');
	});

	it('has ssh section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('ssh-section');
	});

	it('has defaults section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('defaults-section');
	});

	it('uses shared GitProviderCards component', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('GitProviderCards');
	});
});
