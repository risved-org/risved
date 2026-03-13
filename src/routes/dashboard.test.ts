import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
	execSync: vi.fn((cmd: string) => {
		if (cmd.includes('df -h')) return '/dev/sda1  50G  20G  28G  42% /\n';
		if (cmd.includes('docker ps')) return '3\n';
		return '';
	})
}));

vi.mock('node:os', () => ({
	default: {
		cpus: () => [{ times: { user: 50, nice: 0, sys: 20, idle: 30, irq: 0 } }],
		totalmem: () => 8_000_000_000,
		freemem: () => 4_000_000_000,
		uptime: () => 90061
	}
}));

vi.mock('$lib/server/db', () => {
	const selectMock = vi.fn();
	return { db: { select: selectMock, __selectMock: selectMock } };
});

vi.mock('drizzle-orm', () => ({
	desc: vi.fn(() => 'desc_fn'),
	eq: vi.fn(() => 'eq_fn'),
	gte: vi.fn(() => 'gte_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	domains: 'domains_table',
	resourceMetrics: { bucket: 'bucket' }
}));

import { db } from '$lib/server/db';
import { load, getSystemHealth, FRAMEWORK_NAMES } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

function setupDbMocks(
	projectRows: unknown[] = [],
	deploymentRows: unknown[] = [],
	domainRows: unknown[] = []
) {
	const orderByProjects = vi.fn().mockResolvedValue(projectRows);
	const orderByDeployments = vi.fn().mockResolvedValue(deploymentRows);
	const whereDomains = vi.fn().mockResolvedValue(domainRows);

	const orderByMetrics = vi.fn().mockResolvedValue([]);

	dbAny.__selectMock
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ orderBy: orderByProjects })
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ orderBy: orderByDeployments })
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ where: whereDomains })
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ orderBy: orderByMetrics })
			})
		});
}

describe('getSystemHealth', () => {
	it('returns CPU, memory, disk, uptime, and container count', () => {
		const health = getSystemHealth();
		expect(health.cpuPercent).toBe(70);
		expect(health.memoryPercent).toBe(50);
		expect(health.diskPercent).toBe(42);
		expect(health.uptime).toBe('1d 1h');
		expect(health.containerCount).toBe(3);
	});
});

describe('FRAMEWORK_NAMES', () => {
	it('maps sveltekit to SvelteKit', () => {
		expect(FRAMEWORK_NAMES['sveltekit']).toBe('SvelteKit');
	});

	it('maps nextjs to Next.js', () => {
		expect(FRAMEWORK_NAMES['nextjs']).toBe('Next.js');
	});
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function callLoad(): Promise<any> {
	return load({} as Parameters<typeof load>[0]);
}

describe('dashboard load', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns health and empty projects list', async () => {
		setupDbMocks();
		const result = await callLoad();
		expect(result.health).toBeDefined();
		expect(result.projects).toEqual([]);
	});

	it('maps projects with latest deployment', async () => {
		setupDbMocks(
			[
				{
					id: 'p1',
					name: 'My App',
					slug: 'my-app',
					frameworkId: 'sveltekit',
					domain: null,
					createdAt: '2026-03-10T00:00:00Z'
				}
			],
			[
				{ projectId: 'p1', status: 'live', commitSha: 'abc1234', createdAt: '2026-03-11T00:00:00Z' }
			],
			[{ projectId: 'p1', hostname: 'myapp.example.com' }]
		);

		const result = await callLoad();
		expect(result.projects).toHaveLength(1);
		const p = result.projects[0];
		expect(p.name).toBe('My App');
		expect(p.framework).toBe('SvelteKit');
		expect(p.status).toBe('live');
		expect(p.commitSha).toBe('abc1234');
		expect(p.domain).toBe('myapp.example.com');
	});

	it('defaults status to stopped when no deployments', async () => {
		setupDbMocks(
			[
				{
					id: 'p1',
					name: 'Test',
					slug: 'test',
					frameworkId: null,
					domain: null,
					createdAt: '2026-03-10'
				}
			],
			[],
			[]
		);

		const result = await callLoad();
		expect(result.projects[0].status).toBe('stopped');
		expect(result.projects[0].framework).toBeNull();
	});

	it('falls back to project domain if no primary domain', async () => {
		setupDbMocks(
			[
				{
					id: 'p1',
					name: 'Test',
					slug: 'test',
					frameworkId: null,
					domain: 'fallback.com',
					createdAt: '2026-03-10'
				}
			],
			[],
			[]
		);

		const result = await callLoad();
		expect(result.projects[0].domain).toBe('fallback.com');
	});
});

describe('dashboard page source', () => {
	it('has health bar with CPU, MEM, DISK, UPTIME, CONTAINERS', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('health-bar');
		for (const label of ['CPU', 'MEM', 'DISK', 'UPTIME', 'CONTAINERS']) {
			expect(mod.default).toContain(label);
		}
	});

	it('has project table with dense rows', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('project-table');
		expect(mod.default).toContain('table-row');
	});

	it('has status dots for project states', async () => {
		const mod = await import('./+page.svelte?raw');
		for (const cls of ['status-live', 'status-failed', 'status-stopped', 'status-building']) {
			expect(mod.default).toContain(cls);
		}
	});

	it('has empty state with CTA', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('empty-state');
		expect(mod.default).toContain('No projects yet');
	});

	it('has framework badge and action buttons', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('framework-badge');
		expect(mod.default).toContain('Redeploy');
	});

	it('uses client-side navigation via goto', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain("from '$app/navigation'");
		expect(mod.default).toContain('goto(');
	});

	it('uses JetBrains Mono and CSS custom properties', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
		expect(mod.default).toContain('--color-bg-1');
	});
});
