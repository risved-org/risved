import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([]);
	const orderByMock = vi.fn(() => ({ limit: limitMock }));
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	return {
		db: {
			select: selectMock,
			__limitMock: limitMock,
			__orderByMock: orderByMock,
			__whereMock: whereMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	desc: vi.fn(() => 'desc_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	webhookDeliveries: { projectId: 'project_id', createdAt: 'created_at' }
}));

import { db } from '$lib/server/db';
import { load } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('delivery list load', () => {
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

	it('returns project and deliveries', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1', name: 'My App', slug: 'my-app' }])
			.mockResolvedValueOnce([
				{
					id: 'del-1',
					event: 'push',
					signatureValid: true,
					actionTaken: 'triggered deployment',
					createdAt: '2026-03-12T00:00:00Z'
				}
			]);

		const result = (await load({
			params: { slug: 'my-app' }
		} as Parameters<typeof load>[0])) as {
			project: { id: string; name: string; slug: string };
			deliveries: Array<{
				id: string;
				event: string;
				signatureValid: boolean;
				actionTaken: string;
				createdAt: string;
			}>;
		};

		expect(result.project.slug).toBe('my-app');
		expect(result.deliveries).toHaveLength(1);
		expect(result.deliveries[0].event).toBe('push');
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

describe('delivery list page source', () => {
	it('has deliveries list section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('deliveries-list');
	});

	it('has delivery rows', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('delivery-row');
	});

	it('has empty state', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('empty-state');
	});

	it('has status badges', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('delivery-status');
	});

	it('uses mono font for event type', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});
});
