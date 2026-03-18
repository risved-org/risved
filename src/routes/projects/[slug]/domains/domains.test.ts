import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([]);
	const whereMock = vi.fn(() => ({ limit: limitMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	const returningMock = vi.fn().mockResolvedValue([{ id: 'dom-1' }]);
	const valuesMock = vi.fn(() => ({ returning: returningMock }));
	const insertMock = vi.fn(() => ({ values: valuesMock }));
	const setMock = vi.fn(() => ({
		where: vi.fn().mockResolvedValue(undefined),
		returning: returningMock
	}));
	const updateMock = vi.fn(() => ({ set: setMock }));
	const deleteMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
	return {
		db: {
			select: selectMock,
			insert: insertMock,
			update: updateMock,
			delete: deleteMock,
			__limitMock: limitMock,
			__whereMock: whereMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn(() => 'and_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	domains: { projectId: 'project_id', id: 'id', hostname: 'hostname' }
}));

vi.mock('$lib/server/dns', () => ({
	getServerIps: vi.fn().mockResolvedValue({ ipv4: '1.2.3.4', ipv6: null }),
	checkDnsRecord: vi.fn().mockResolvedValue({ resolved: true })
}));

vi.mock('$lib/server/caddy', () => ({
	CaddyClient: vi.fn(() => ({
		addRoute: vi.fn(),
		removeRoute: vi.fn()
	}))
}));

import { db } from '$lib/server/db';
import { load, actions } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('domains load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
		dbAny.__whereMock.mockReturnValue({ limit: dbAny.__limitMock });
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);
		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns project, domains, and serverIp', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([
			{ id: 'proj-1', name: 'Test', slug: 'test', port: 3001 }
		]);
		dbAny.__whereMock.mockReturnValueOnce({
			limit: dbAny.__limitMock
		});
		dbAny.__whereMock.mockReturnValueOnce([
			{
				id: 'dom-1',
				hostname: 'test.com',
				isPrimary: true,
				sslStatus: 'active',
				verifiedAt: '2026-03-12',
				createdAt: '2026-03-12'
			}
		]);

		const result = (await load({
			params: { slug: 'test' }
		} as Parameters<typeof load>[0])) as {
			project: { id: string; slug: string };
			domains: Array<{ id: string; hostname: string }>;
			serverIps: { ipv4: string | null; ipv6: string | null };
		};

		expect(result.project.slug).toBe('test');
		expect(result.serverIps).toEqual({ ipv4: '1.2.3.4', ipv6: null });
	});

	it('calls db.select for project lookup', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);
		try {
			await load({ params: { slug: 'x' } } as Parameters<typeof load>[0]);
		} catch {
			/* 404 */
		}
		expect(db.select).toHaveBeenCalled();
	});
});

describe('domains actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
		dbAny.__whereMock.mockReturnValue({ limit: dbAny.__limitMock });
	});

	it('add returns error for empty hostname', async () => {
		const formData = new FormData();
		formData.set('hostname', '');
		const result = await actions.add({
			params: { slug: 'test' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.add>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('add returns error for invalid hostname', async () => {
		const formData = new FormData();
		formData.set('hostname', '!!!invalid!!!');
		const result = await actions.add({
			params: { slug: 'test' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.add>[0]);

		expect(result).toMatchObject({ status: 400 });
	});

	it('add inserts domain when valid', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test', port: 3001 }]) // project lookup
			.mockResolvedValueOnce([]); // no existing domain

		const formData = new FormData();
		formData.set('hostname', 'app.example.com');
		const result = await actions.add({
			params: { slug: 'test' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.add>[0]);

		expect(result).toMatchObject({ added: true });
		expect(db.insert).toHaveBeenCalled();
	});
});

describe('domains page source', () => {
	it('has domains list section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('domains-list');
	});

	it('has domain table', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('domain-table');
	});

	it('has add domain form', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('add-domain-section');
	});

	it('has DNS record display', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('dns-record');
	});

	it('has routing diagram', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('routing-diagram');
	});

	it('has copy IP button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('copy-ip-btn');
	});

	it('has SSL status badges', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('ssl-status');
	});

	it('uses mono font for hostnames', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});
});
