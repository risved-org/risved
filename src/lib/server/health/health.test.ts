import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), insert: vi.fn() }
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	healthEvents: { projectId: 'project_id' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	desc: vi.fn(() => 'desc_fn')
}));

vi.mock('node:child_process', () => ({
	execSync: vi.fn()
}));

import { execSync } from 'node:child_process';
import { db } from '$lib/server/db';
import { HealthMonitor } from './index';

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	insert: ReturnType<typeof vi.fn>;
};

/* ── Helpers ──────────────────────────────────────────────────────── */

function setupDbMocks(projectRows: unknown[] = [], deploymentRows: unknown[] = []) {
	/* getLiveProjects: db.select().from(projects) — resolves directly */
	/* getLiveProjects: db.select().from(deployments).orderBy(...) */
	mockDb.select
		.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue(projectRows)
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockResolvedValue(deploymentRows)
			})
		});

	mockDb.insert.mockReturnValue({
		values: vi.fn().mockResolvedValue(undefined)
	});
}

function createMockFetch(healthy: boolean) {
	return vi.fn().mockImplementation(() => {
		if (healthy) {
			return Promise.resolve({ ok: true, status: 200 });
		}
		return Promise.reject(new Error('Connection refused'));
	});
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('HealthMonitor', () => {
	let monitor: HealthMonitor;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		monitor?.stop();
	});

	describe('checkOne', () => {
		it('marks container as healthy on successful HTTP check', async () => {
			const fetchFn = createMockFetch(true);
			monitor = new HealthMonitor({ fetchFn });

			mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

			const result = await monitor.checkOne('p-1', 'my-app', 3001);
			expect(result).toBe(true);

			const status = monitor.get('p-1');
			expect(status?.healthy).toBe(true);
			expect(status?.consecutiveFailures).toBe(0);
		});

		it('increments consecutive failures on HTTP check failure', async () => {
			const fetchFn = createMockFetch(false);
			monitor = new HealthMonitor({ fetchFn, failureThreshold: 5 });

			mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

			await monitor.checkOne('p-1', 'my-app', 3001);
			const status = monitor.get('p-1');
			expect(status?.healthy).toBe(false);
			expect(status?.consecutiveFailures).toBe(1);
		});

		it('triggers restart after reaching failure threshold', async () => {
			const fetchFn = createMockFetch(false);
			monitor = new HealthMonitor({ fetchFn, failureThreshold: 3 });

			mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
			vi.mocked(execSync).mockReturnValue('');

			await monitor.checkOne('p-1', 'my-app', 3001);
			await monitor.checkOne('p-1', 'my-app', 3001);
			await monitor.checkOne('p-1', 'my-app', 3001);

			expect(execSync).toHaveBeenCalledWith('docker restart my-app', { timeout: 30000 });

			const status = monitor.get('p-1');
			expect(status?.totalRestarts).toBe(1);
			expect(status?.consecutiveFailures).toBe(0);
		});

		it('does not restart before reaching threshold', async () => {
			const fetchFn = createMockFetch(false);
			monitor = new HealthMonitor({ fetchFn, failureThreshold: 3 });

			mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

			await monitor.checkOne('p-1', 'my-app', 3001);
			await monitor.checkOne('p-1', 'my-app', 3001);

			expect(execSync).not.toHaveBeenCalled();
			expect(monitor.get('p-1')?.consecutiveFailures).toBe(2);
		});

		it('resets failure count on recovery', async () => {
			const fetchFn = vi.fn();
			monitor = new HealthMonitor({ fetchFn, failureThreshold: 5 });

			mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

			/* Fail twice */
			fetchFn.mockRejectedValueOnce(new Error('down'));
			await monitor.checkOne('p-1', 'my-app', 3001);
			fetchFn.mockRejectedValueOnce(new Error('down'));
			await monitor.checkOne('p-1', 'my-app', 3001);
			expect(monitor.get('p-1')?.consecutiveFailures).toBe(2);

			/* Recover */
			fetchFn.mockResolvedValueOnce({ ok: true, status: 200 });
			await monitor.checkOne('p-1', 'my-app', 3001);
			expect(monitor.get('p-1')?.healthy).toBe(true);
			expect(monitor.get('p-1')?.consecutiveFailures).toBe(0);
		});

		it('handles <500 status as healthy', async () => {
			const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
			monitor = new HealthMonitor({ fetchFn });

			mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

			const result = await monitor.checkOne('p-1', 'app', 3001);
			expect(result).toBe(true);
		});
	});

	describe('checkAll', () => {
		it('checks all live projects', async () => {
			const fetchFn = createMockFetch(true);
			monitor = new HealthMonitor({ fetchFn });

			setupDbMocks(
				[
					{ id: 'p-1', slug: 'app1', port: 3001 },
					{ id: 'p-2', slug: 'app2', port: 3002 }
				],
				[
					{ projectId: 'p-1', status: 'live', createdAt: '2026-01-01' },
					{ projectId: 'p-2', status: 'live', createdAt: '2026-01-01' }
				]
			);

			await monitor.checkAll();

			expect(fetchFn).toHaveBeenCalledTimes(2);
			expect(monitor.getAll()).toHaveLength(2);
		});

		it('skips projects without live deployments', async () => {
			const fetchFn = createMockFetch(true);
			monitor = new HealthMonitor({ fetchFn });

			setupDbMocks(
				[
					{ id: 'p-1', slug: 'app1', port: 3001 },
					{ id: 'p-2', slug: 'app2', port: 3002 }
				],
				[{ projectId: 'p-1', status: 'live', createdAt: '2026-01-01' }]
			);

			await monitor.checkAll();

			expect(fetchFn).toHaveBeenCalledTimes(1);
			expect(monitor.getAll()).toHaveLength(1);
		});

		it('removes stale entries for projects no longer live', async () => {
			const fetchFn = createMockFetch(true);
			monitor = new HealthMonitor({ fetchFn });

			/* First check - p-1 is live */
			setupDbMocks(
				[{ id: 'p-1', slug: 'app1', port: 3001 }],
				[{ projectId: 'p-1', status: 'live', createdAt: '2026-01-01' }]
			);
			await monitor.checkAll();
			expect(monitor.getAll()).toHaveLength(1);

			/* Second check - p-1 is no longer live */
			setupDbMocks([{ id: 'p-1', slug: 'app1', port: 3001 }], []);
			await monitor.checkAll();
			expect(monitor.getAll()).toHaveLength(0);
		});
	});

	describe('start / stop', () => {
		it('starts and stops the monitor without errors', () => {
			monitor = new HealthMonitor({ intervalMs: 100000 });
			monitor.start();
			/* Starting again should be a no-op */
			monitor.start();
			monitor.stop();
			expect(monitor.getAll()).toEqual([]);
		});
	});

	describe('getAll', () => {
		it('returns empty array when no projects monitored', () => {
			monitor = new HealthMonitor();
			expect(monitor.getAll()).toEqual([]);
		});
	});
});
