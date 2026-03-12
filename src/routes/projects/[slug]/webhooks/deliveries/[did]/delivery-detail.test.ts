import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([]);
	const whereMock = vi.fn(() => ({ limit: limitMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	const valuesMock = vi.fn().mockResolvedValue(undefined);
	const insertMock = vi.fn(() => ({ values: valuesMock }));
	return {
		db: {
			select: selectMock,
			insert: insertMock,
			__limitMock: limitMock,
			__whereMock: whereMock,
			__valuesMock: valuesMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args)
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	webhookDeliveries: {
		id: 'id',
		projectId: 'project_id',
		createdAt: 'created_at'
	}
}));

vi.mock('$lib/server/webhook', () => ({
	verifySignature: vi.fn(() => true),
	parseWebhookPayload: vi.fn(() => ({ type: 'push', branch: 'main' }))
}));

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({}))
}));

import { db } from '$lib/server/db';
import { load, actions } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('delivery detail load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);
		await expect(
			load({ params: { slug: 'nonexistent', did: 'del-1' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('throws 404 when delivery not found', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1', name: 'App', slug: 'app' }])
			.mockResolvedValueOnce([]);

		await expect(
			load({ params: { slug: 'app', did: 'missing' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns delivery with parsed headers and payload', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1', name: 'App', slug: 'app' }])
			.mockResolvedValueOnce([
				{
					id: 'del-1',
					event: 'push',
					signatureValid: true,
					actionTaken: 'triggered deployment',
					createdAt: '2026-03-12T00:00:00Z',
					headers: '{"content-type":"application/json"}',
					payload: '{"ref":"refs/heads/main"}'
				}
			]);

		const result = (await load({
			params: { slug: 'app', did: 'del-1' }
		} as Parameters<typeof load>[0])) as {
			delivery: {
				id: string;
				headers: Record<string, string>;
				payload: unknown;
			};
		};

		expect(result.delivery.id).toBe('del-1');
		expect(result.delivery.headers['content-type']).toBe('application/json');
		expect((result.delivery.payload as Record<string, string>).ref).toBe('refs/heads/main');
	});
});

describe('delivery detail redeliver action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);
		await expect(
			actions.redeliver({
				params: { slug: 'nonexistent', did: 'del-1' }
			} as Parameters<typeof actions.redeliver>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('creates a redelivery record', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([
				{
					id: 'proj-1',
					name: 'App',
					slug: 'app',
					repoUrl: 'https://github.com/test/app',
					branch: 'main',
					port: 3001,
					domain: null,
					frameworkId: null,
					tier: null,
					webhookSecret: 'secret123'
				}
			])
			.mockResolvedValueOnce([
				{
					id: 'del-1',
					event: 'push',
					signatureValid: true,
					actionTaken: 'triggered deployment',
					createdAt: '2026-03-12T00:00:00Z',
					headers: '{"content-type":"application/json"}',
					payload: '{"ref":"refs/heads/main"}'
				}
			]);

		const result = await actions.redeliver({
			params: { slug: 'app', did: 'del-1' }
		} as Parameters<typeof actions.redeliver>[0]);

		expect(result).toMatchObject({ redelivered: true });
		expect(db.insert).toHaveBeenCalled();
	});
});

describe('delivery detail page source', () => {
	it('has metadata section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('metadata-section');
		expect(mod.default).toContain('meta-grid');
	});

	it('has headers section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('headers-section');
		expect(mod.default).toContain('headers-block');
	});

	it('has payload section with syntax colouring', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('payload-section');
		expect(mod.default).toContain('json-key');
		expect(mod.default).toContain('json-string');
	});

	it('has redeliver button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('redeliver-btn');
		expect(mod.default).toContain('Redeliver');
	});

	it('has signature status display', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('sig-status');
		expect(mod.default).toContain('sig-valid');
		expect(mod.default).toContain('sig-invalid');
	});

	it('uses enhance for form', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});
});
