import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
	execSync: vi.fn((cmd: string) => {
		if (cmd.includes('df -h')) return '/dev/sda1  50G  20G  28G  42% /\n';
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
import { _getSystemHealth as getSystemHealth } from './(dashboard)/+layout.server';
import { load, _FRAMEWORK_NAMES as FRAMEWORK_NAMES } from './(dashboard)/projects/+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

function setupDbMocks(
	projectRows: unknown[] = [],
	deploymentRows: unknown[] = [],
	domainRows: unknown[] = []
) {
	const orderByProjects = vi.fn().mockResolvedValue(projectRows);
	const orderByDeployments = vi.fn().mockResolvedValue(deploymentRows);
	const whereDomains = vi.fn().mockResolvedValue(domainRows);

	dbAny.__selectMock
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ orderBy: orderByProjects })
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ orderBy: orderByDeployments })
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ where: whereDomains })
		});
}

describe('getSystemHealth', () => {
	it('returns CPU, memory, disk, and uptime', () => {
		const health = getSystemHealth();
		expect(health.cpuPercent).toBe(70);
		expect(health.memoryPercent).toBe(50);
		expect(health.diskPercent).toBe(42);
		expect(health.uptime).toBe('1d 1h');
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

	it('returns empty projects list', async () => {
		setupDbMocks();
		const result = await callLoad();
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

	it('keeps live production status when the latest build failed', async () => {
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
				{
					projectId: 'p1',
					status: 'failed',
					commitSha: 'bad1234',
					createdAt: '2026-03-12T00:00:00Z'
				},
				{
					projectId: 'p1',
					status: 'live',
					commitSha: 'good567',
					createdAt: '2026-03-11T00:00:00Z'
				}
			],
			[]
		);

		const result = await callLoad();
		const p = result.projects[0];
		expect(p.status).toBe('live');
		expect(p.commitSha).toBe('good567');
		expect(p.lastDeployedAt).toBe('2026-03-11T00:00:00Z');
		expect(p.buildStatus).toBe('failed');
		expect(p.buildCommitSha).toBe('bad1234');
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
	it('has health bar with CPU, MEM, DISK, UP', async () => {
		const mod = await import('$lib/components/DashboardHeader.svelte?raw');
		expect(mod.default).toContain('data-testid="health-bar"');
		for (const label of ['CPU', 'MEM', 'DISK', 'UP']) {
			expect(mod.default).toContain(label);
		}
	});

	it('has project card grid', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain('project-grid');
		expect(mod.default).toContain('project-card');
	});

	it('has status badges for project states', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		for (const cls of ['badge-live', 'badge-failed', 'badge-muted', 'badge-building']) {
			expect(mod.default).toContain(cls);
		}
	});

	it('has empty state with CTA', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain('empty-state');
		expect(mod.default).toContain('Nothing deployed yet');
	});

	it('shows framework name on each card', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain('project.framework');
		expect(mod.default).toContain('badge-neutral');
	});

	it('uses anchor links to project pages', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain("from '$app/paths'");
		expect(mod.default).toContain("resolve(`/projects/${project.slug}`)");
	});

	it('keeps the project card link separate from the site link', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain('card-link');
		expect(mod.default).toContain('card-domain');
		expect(mod.default).toContain('onclick={(event) => event.stopPropagation()}');
		expect(mod.default).toContain('align-items: flex-start');
	});

	it('shows latest build notices on project cards', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain('project.buildStatus');
		expect(mod.default).toContain('card-build');
		expect(mod.default).toContain('project.buildCommitSha');
	});

	it('uses mono class and CSS custom properties', async () => {
		const mod = await import('./(dashboard)/projects/+page.svelte?raw');
		expect(mod.default).toContain('mono');
		expect(mod.default).toContain('--color-bg-1');
	});
});
