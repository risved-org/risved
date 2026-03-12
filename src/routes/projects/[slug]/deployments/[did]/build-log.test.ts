import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const orderByMock = vi.fn().mockResolvedValue([]);
	const limitMock = vi.fn();
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }));
	const fromMock = vi.fn(() => ({ where: whereMock, orderBy: orderByMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	return {
		db: {
			select: selectMock,
			__fromMock: fromMock,
			__whereMock: whereMock,
			__limitMock: limitMock,
			__orderByMock: orderByMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	asc: vi.fn(() => 'asc_fn'),
	desc: vi.fn(() => 'desc_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	domains: 'domains_table',
	buildLogs: 'build_logs_table'
}));

import { db } from '$lib/server/db';
import { load } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeLoadEvent(slug = 'test-project', did = 'dep-1') {
	return {
		params: { slug, did }
	} as unknown as Parameters<typeof load>[0];
}

describe('build log load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		await expect(load(makeLoadEvent())).rejects.toMatchObject({
			status: 404
		});
	});

	it('throws 404 when deployment not found', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-project', domain: null }])
			.mockResolvedValueOnce([]);

		await expect(load(makeLoadEvent())).rejects.toMatchObject({
			status: 404
		});
	});

	it('returns deployment data with logs', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([
				{ id: 'proj-1', name: 'Test', slug: 'test-project', domain: 'test.example.com' }
			])
			.mockResolvedValueOnce([
				{
					id: 'dep-1',
					projectId: 'proj-1',
					status: 'live',
					commitSha: 'abc1234',
					startedAt: '2026-03-12T00:00:00Z',
					finishedAt: '2026-03-12T00:01:00Z',
					createdAt: '2026-03-12T00:00:00Z'
				}
			])
			.mockResolvedValueOnce([]);

		dbAny.__orderByMock.mockResolvedValueOnce([
			{ timestamp: '2026-03-12T00:00:01Z', phase: 'clone', level: 'info', message: 'Cloning...' }
		]);

		const result = (await load(makeLoadEvent())) as Record<string, unknown>;
		expect(result.project).toBeDefined();
		expect(result.deployment).toBeDefined();
		expect(result.logs).toBeDefined();
		expect(result.isTerminal).toBe(true);
		expect(result.phases).toBeDefined();
	});

	it('marks in-progress deployment as non-terminal', async () => {
		dbAny.__limitMock
			.mockResolvedValueOnce([{ id: 'proj-1', name: 'Test', slug: 'test-project', domain: null }])
			.mockResolvedValueOnce([
				{
					id: 'dep-1',
					projectId: 'proj-1',
					status: 'building',
					commitSha: null,
					startedAt: null,
					finishedAt: null,
					createdAt: '2026-03-12T00:00:00Z'
				}
			])
			.mockResolvedValueOnce([]);

		dbAny.__orderByMock.mockResolvedValueOnce([]);

		const result = (await load(makeLoadEvent())) as Record<string, unknown>;
		expect(result.isTerminal).toBe(false);
	});
});

describe('build log page source', () => {
	it('has phase indicator', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('phase-indicator');
		expect(mod.default).toContain('phase-step');
	});

	it('has terminal output area', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('terminal');
		expect(mod.default).toContain('log-line');
	});

	it('has metadata bar with commit and elapsed', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('metadata-bar');
		expect(mod.default).toContain('commit-sha');
		expect(mod.default).toContain('elapsed-time');
	});

	it('has success actions for live deployments', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('success-actions');
		expect(mod.default).toContain('live-link');
		expect(mod.default).toContain('view-project-btn');
	});

	it('has error summary for failed deployments', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('error-summary');
		expect(mod.default).toContain('retry-btn');
	});

	it('uses JetBrains Mono for terminal output', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});

	it('has cursor blink animation', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('cursor-blink');
	});

	it('uses EventSource for SSE streaming', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('EventSource');
	});
});
