import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	resourceMetrics: {
		projectId: 'project_id',
		bucket: 'bucket',
		id: 'id'
	}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
	and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
	desc: vi.fn(() => 'desc_fn'),
	gte: vi.fn(() => 'gte_fn'),
	lt: vi.fn(() => 'lt_fn')
}));

vi.mock('node:child_process', () => ({
	execSync: vi.fn()
}));

import { db } from '$lib/server/db';
import {
	MetricsCollector,
	parseStatsOutput,
	toBucket,
	getProjectMetrics,
	getServerMetrics
} from './index';

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	insert: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

/* ── Helpers ──────────────────────────────────────────────────────── */

function setupCollectMocks(
	projectRows: unknown[] = [],
	deploymentRows: unknown[] = [],
	existingMetrics: unknown[] = []
) {
	/* getLiveContainerMap: db.select().from(projects) */
	/* getLiveContainerMap: db.select().from(deployments).orderBy(...) */
	/* upsertMetric: db.select().from(resourceMetrics).where(...).limit(1) */
	mockDb.select
		.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue(projectRows)
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockResolvedValue(deploymentRows)
			})
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(existingMetrics)
				})
			})
		});

	mockDb.insert.mockReturnValue({
		values: vi.fn().mockResolvedValue(undefined)
	});

	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	});

	mockDb.delete.mockReturnValue({
		where: vi.fn().mockResolvedValue(undefined)
	});
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('toBucket', () => {
	it('truncates date to the start of the hour', () => {
		const date = new Date('2026-03-13T14:37:22.123Z');
		expect(toBucket(date)).toBe('2026-03-13T14:00:00.000Z');
	});

	it('handles exact hour boundary', () => {
		const date = new Date('2026-03-13T10:00:00.000Z');
		expect(toBucket(date)).toBe('2026-03-13T10:00:00.000Z');
	});
});

describe('parseStatsOutput', () => {
	it('parses docker stats format correctly', () => {
		const output = 'myapp|12.50%|256MiB / 2GiB\nother|3.20%|128MiB / 1GiB\n';
		const containerMap = new Map([['myapp', 'p-1']]);

		const stats = parseStatsOutput(output, containerMap);
		expect(stats).toHaveLength(1);
		expect(stats[0].projectId).toBe('p-1');
		expect(stats[0].cpuPercent).toBe(12.5);
		expect(stats[0].memoryMb).toBe(256);
		expect(stats[0].memoryLimitMb).toBe(2048);
	});

	it('handles GiB memory units', () => {
		const output = 'app|1.00%|1.5GiB / 4GiB\n';
		const containerMap = new Map([['app', 'p-1']]);

		const stats = parseStatsOutput(output, containerMap);
		expect(stats[0].memoryMb).toBe(1536);
		expect(stats[0].memoryLimitMb).toBe(4096);
	});

	it('skips unknown containers', () => {
		const output = 'unknown|5.00%|100MiB / 1GiB\n';
		const containerMap = new Map([['myapp', 'p-1']]);

		const stats = parseStatsOutput(output, containerMap);
		expect(stats).toHaveLength(0);
	});

	it('handles empty output', () => {
		const stats = parseStatsOutput('', new Map());
		expect(stats).toHaveLength(0);
	});

	it('handles malformed lines', () => {
		const output = 'invalid line\n';
		const stats = parseStatsOutput(output, new Map([['app', 'p-1']]));
		expect(stats).toHaveLength(0);
	});
});

describe('MetricsCollector', () => {
	let collector: MetricsCollector;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		collector?.stop();
	});

	describe('start / stop', () => {
		it('starts and stops without errors', () => {
			collector = new MetricsCollector({ intervalMs: 100000 });
			collector.start();
			collector.start(); // no-op
			collector.stop();
			expect(true).toBe(true);
		});
	});

	describe('collect', () => {
		it('collects and stores metrics for live containers', async () => {
			const execFn = vi.fn().mockReturnValue('myapp|5.00%|200MiB / 2GiB\n');

			collector = new MetricsCollector({ execFn });

			setupCollectMocks(
				[{ id: 'p-1', slug: 'myapp', port: 3001 }],
				[{ projectId: 'p-1', status: 'live', createdAt: '2026-01-01' }],
				[] // no existing metrics
			);

			await collector.collect();

			expect(execFn).toHaveBeenCalledTimes(1);
			expect(mockDb.insert).toHaveBeenCalled();
		});

		it('updates existing bucket when metric already exists', async () => {
			const execFn = vi.fn().mockReturnValue('myapp|10.00%|300MiB / 2GiB\n');

			collector = new MetricsCollector({ execFn });

			setupCollectMocks(
				[{ id: 'p-1', slug: 'myapp', port: 3001 }],
				[{ projectId: 'p-1', status: 'live', createdAt: '2026-01-01' }],
				[{ id: 1, cpuPercent: 500, memoryMb: 200, memoryLimitMb: 2048, sampleCount: 1 }]
			);

			await collector.collect();

			expect(mockDb.update).toHaveBeenCalled();
		});

		it('handles empty container map gracefully', async () => {
			const execFn = vi.fn();
			collector = new MetricsCollector({ execFn });

			setupCollectMocks([], []);

			await collector.collect();
			expect(execFn).not.toHaveBeenCalled();
		});

		it('handles exec failure gracefully', async () => {
			const execFn = vi.fn().mockImplementation(() => {
				throw new Error('docker not found');
			});

			collector = new MetricsCollector({ execFn });

			setupCollectMocks(
				[{ id: 'p-1', slug: 'myapp', port: 3001 }],
				[{ projectId: 'p-1', status: 'live', createdAt: '2026-01-01' }]
			);

			// Should not throw
			await expect(collector.collect()).resolves.toBeUndefined();
		});
	});
});

function setupQueryMock(rows: unknown[]) {
	const orderByFn = vi.fn().mockResolvedValue(rows);
	const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
	const fromFn = vi.fn().mockReturnValue({ where: whereFn });
	mockDb.select.mockReturnValueOnce({ from: fromFn });
}

describe('getProjectMetrics', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns formatted metric points', async () => {
		setupQueryMock([
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 500,
				memoryMb: 256,
				memoryLimitMb: 2048,
				sampleCount: 5
			}
		]);

		const metrics = await getProjectMetrics('p-1', 24);
		expect(metrics).toHaveLength(1);
		expect(metrics[0].cpuPercent).toBe(5); // 500 / 100
		expect(metrics[0].memoryMb).toBe(256);
		expect(metrics[0].bucket).toBe('2026-03-13T10:00:00.000Z');
	});
});

describe('getServerMetrics', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('aggregates metrics across projects by bucket', async () => {
		setupQueryMock([
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 500,
				memoryMb: 256,
				memoryLimitMb: 2048,
				sampleCount: 3
			},
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 300,
				memoryMb: 128,
				memoryLimitMb: 1024,
				sampleCount: 2
			}
		]);

		const metrics = await getServerMetrics(24);
		expect(metrics).toHaveLength(1);
		expect(metrics[0].cpuPercent).toBe(8); // (500 + 300) / 100
		expect(metrics[0].memoryMb).toBe(384); // 256 + 128
	});

	it('returns empty array when no metrics', async () => {
		setupQueryMock([]);

		const metrics = await getServerMetrics(24);
		expect(metrics).toEqual([]);
	});
});
