import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([]);
	const whereMock = vi.fn(() => ({ limit: limitMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
	const updateMock = vi.fn(() => ({ set: setMock }));
	return {
		db: {
			select: selectMock,
			update: updateMock,
			__limitMock: limitMock,
			__whereMock: whereMock,
			__setMock: setMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table'
}));

vi.mock('$lib/server/api-utils', () => ({
	generateWebhookSecret: vi.fn(() => 'new-secret-abc123')
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue('risved.example.com')
}));

import { db } from '$lib/server/db';
import { load, actions } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('webhook config load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns project webhook data and payload URL', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([
			{
				id: 'proj-1',
				name: 'My App',
				slug: 'my-app',
				branch: 'main',
				webhookSecret: 'whsec_test',
				webhookPushEnabled: true,
				webhookPrMergedEnabled: true
			}
		]);

		const result = (await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])) as {
			project: { webhookSecret: string };
			payloadUrl: string;
			risvedDomain: string;
		};
		expect(result.project.webhookSecret).toBe('whsec_test');
		expect(result.payloadUrl).toContain('/api/webhooks/proj-1');
		expect(result.risvedDomain).toBe('risved.example.com');
	});

	it('calls db.select for project lookup', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		try {
			await load({ params: { slug: 'test' } } as Parameters<typeof load>[0]);
		} catch {
			/* expected 404 */
		}

		expect(db.select).toHaveBeenCalled();
	});
});

describe('webhook config regenerate action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('returns 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		const result = await actions.regenerate({
			params: { slug: 'nonexistent' }
		} as Parameters<typeof actions.regenerate>[0]);
		expect(result).toMatchObject({ status: 404 });
	});

	it('regenerates webhook secret', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]);

		const result = await actions.regenerate({
			params: { slug: 'my-app' }
		} as Parameters<typeof actions.regenerate>[0]);
		expect(result).toMatchObject({ regenerated: true });
		expect(db.update).toHaveBeenCalled();
	});
});

describe('webhook config update action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('returns 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		const formData = new FormData();
		formData.set('branch', 'main');

		const result = await actions.update({
			params: { slug: 'nonexistent' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.update>[0]);
		expect(result).toMatchObject({ status: 404 });
	});

	it('updates branch and event toggles', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]);

		const formData = new FormData();
		formData.set('branch', 'develop');
		formData.set('webhookPushEnabled', 'on');

		const result = await actions.update({
			params: { slug: 'my-app' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.update>[0]);
		expect(result).toMatchObject({ updated: true });
		expect(db.update).toHaveBeenCalled();
	});
});

describe('webhook config page source', () => {
	it('has payload URL section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('payload-url-section');
		expect(mod.default).toContain('copy-url-btn');
	});

	it('has webhook secret section with regenerate', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('secret-section');
		expect(mod.default).toContain('regenerate-btn');
	});

	it('has provider tabs', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('provider-tabs');
		expect(mod.default).toContain('provider-tab-{p.id}');
	});

	it('has branch filter input', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('branch-input');
	});

	it('has event toggles', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('toggle-push');
		expect(mod.default).toContain('toggle-pr-merged');
		expect(mod.default).toContain('webhookPushEnabled');
		expect(mod.default).toContain('webhookPrMergedEnabled');
	});

	it('uses enhance for forms', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});

	it('uses JetBrains Mono for URLs and secrets', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});

	it('has save button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('save-btn');
		expect(mod.default).toContain('Save settings');
	});
});
