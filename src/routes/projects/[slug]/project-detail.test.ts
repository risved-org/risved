import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const orderByMock = vi.fn().mockResolvedValue([]);
	const limitMock = vi.fn().mockResolvedValue([]);
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }));
	const fromMock = vi.fn(() => ({ where: whereMock, orderBy: orderByMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
	const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));
	return {
		db: {
			select: selectMock,
			delete: deleteMock,
			__limitMock: limitMock,
			__orderByMock: orderByMock,
			__whereMock: whereMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	desc: vi.fn(() => 'desc_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	domains: 'domains_table',
	envVars: 'env_vars_table',
	webhookDeliveries: 'webhook_deliveries_table'
}));

import { db } from '$lib/server/db';
import { load, actions } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('project detail load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
		dbAny.__orderByMock.mockResolvedValue([]);
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('calls db.select for project lookup', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		try {
			await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0]);
		} catch {
			/* expected 404 */
		}

		expect(db.select).toHaveBeenCalled();
	});
});

describe('project detail delete action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('returns 404 when project not found for delete', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		const result = await actions.delete({
			params: { slug: 'nonexistent' }
		} as Parameters<typeof actions.delete>[0]);
		expect(result).toMatchObject({ status: 404 });
	});

	it('deletes project and redirects', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]);

		await expect(
			actions.delete({
				params: { slug: 'test-app' }
			} as Parameters<typeof actions.delete>[0])
		).rejects.toMatchObject({ status: 303, location: '/' });
	});
});

describe('project detail page source', () => {
	it('has project header with name and framework', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('project-header');
		expect(mod.default).toContain('framework-badge');
	});

	it('has deployments section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('deployments-section');
		expect(mod.default).toContain('deploy-row');
	});

	it('has webhook section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('webhook-section');
		expect(mod.default).toContain('Webhook active');
	});

	it('has environment variables section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('env-section');
		expect(mod.default).toContain('env-line');
	});

	it('has domains section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('domains-section');
		expect(mod.default).toContain('domain-row');
	});

	it('has danger zone with delete', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('danger-zone');
		expect(mod.default).toContain('Delete project');
		expect(mod.default).toContain('confirm-delete-btn');
	});

	it('uses enhance for form submission', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});

	it('uses JetBrains Mono for SHAs and domains', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});
});
