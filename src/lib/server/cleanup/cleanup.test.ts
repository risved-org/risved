import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), delete: vi.fn() }
}));

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id', createdAt: 'created_at' },
	buildLogs: { deploymentId: 'deployment_id' },
	cronRuns: { startedAt: 'started_at' }
}));

vi.mock('drizzle-orm', () => ({
	lt: vi.fn((_col, val) => ({ op: 'lt', val })),
	inArray: vi.fn((_col, vals) => ({ op: 'inArray', vals }))
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}));

import { db } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';
import { CleanupManager, parseDockerSize, formatBytes } from './index';

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};
const mockGetSetting = getSetting as ReturnType<typeof vi.fn>;

/* ── Helpers ──────────────────────────────────────────────────────── */

function setupDbMocks(oldDeployments: { id: string }[] = []) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(oldDeployments)
		})
	});

	mockDb.delete.mockReturnValue({
		where: vi.fn().mockResolvedValue({ changes: oldDeployments.length })
	});
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('CleanupManager', () => {
	let manager: CleanupManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new CleanupManager({ retentionDays: 30 });
	});

	afterEach(() => {
		manager.stop();
	});

	it('starts and stops timer', () => {
		expect(manager.isRunning()).toBe(false);
		manager.start();
		expect(manager.isRunning()).toBe(true);
		manager.stop();
		expect(manager.isRunning()).toBe(false);
	});

	it('does not start twice', () => {
		manager.start();
		manager.start();
		expect(manager.isRunning()).toBe(true);
		manager.stop();
	});

	it('runCleanup returns zero when no old deployments', async () => {
		mockGetSetting.mockResolvedValue(null);
		setupDbMocks([]);

		const result = await manager.runCleanup();

		expect(result.deploymentsRemoved).toBe(0);
		expect(result.buildLogsRemoved).toBe(0);
	});

	it('runCleanup deletes old deployments and build logs', async () => {
		mockGetSetting.mockResolvedValue('7');
		setupDbMocks([{ id: 'deploy-1' }, { id: 'deploy-2' }]);

		const result = await manager.runCleanup();

		expect(result.deploymentsRemoved).toBe(2);
		/* 3 deletes: cronRuns cleanup + buildLogs + deployments */
		expect(mockDb.delete).toHaveBeenCalledTimes(3);
	});

	it('uses default retention when setting is invalid', async () => {
		mockGetSetting.mockResolvedValue('not-a-number');
		setupDbMocks([]);

		const result = await manager.runCleanup();

		expect(result.deploymentsRemoved).toBe(0);
		expect(result.cutoffDate).toBeTruthy();
	});

	it('uses setting value for retention days', async () => {
		mockGetSetting.mockResolvedValue('14');
		setupDbMocks([]);

		const result = await manager.runCleanup();

		/* cutoff should be ~14 days ago */
		const cutoff = new Date(result.cutoffDate);
		const expectedApprox = new Date();
		expectedApprox.setDate(expectedApprox.getDate() - 14);

		const diffMs = Math.abs(cutoff.getTime() - expectedApprox.getTime());
		expect(diffMs).toBeLessThan(5000); // within 5 seconds
	});

	it('prevents concurrent cleanup runs', async () => {
		mockGetSetting.mockResolvedValue(null);

		/* Make the first call slow */
		let resolveFirst: () => void;
		const firstPromise = new Promise<void>((r) => (resolveFirst = r));

		mockDb.select.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockImplementation(async () => {
					await firstPromise;
					return [];
				})
			})
		});

		const run1 = manager.runCleanup();
		const run2 = manager.runCleanup();

		const result2 = await run2;
		expect(result2.deploymentsRemoved).toBe(0);
		expect(result2.cutoffDate).toBe('');

		resolveFirst!();
		await run1;
	});
});

describe('parseDockerSize', () => {
	it('parses various Docker size strings', () => {
		expect(parseDockerSize('0B')).toBe(0);
		expect(parseDockerSize('100B')).toBe(100);
		expect(parseDockerSize('1.5kB')).toBe(1500);
		expect(parseDockerSize('200MB')).toBe(200_000_000);
		expect(parseDockerSize('1.5GB')).toBe(1_500_000_000);
		expect(parseDockerSize('2TB')).toBe(2_000_000_000_000);
	});

	it('returns 0 for invalid strings', () => {
		expect(parseDockerSize('')).toBe(0);
		expect(parseDockerSize('invalid')).toBe(0);
		expect(parseDockerSize('abc MB')).toBe(0);
	});
});

describe('formatBytes', () => {
	it('formats byte values', () => {
		expect(formatBytes(0)).toBe('0B');
		expect(formatBytes(500)).toBe('500B');
		expect(formatBytes(1500)).toBe('1.50KB');
		expect(formatBytes(1_500_000)).toBe('1.50MB');
		expect(formatBytes(1_500_000_000)).toBe('1.50GB');
	});

	it('adjusts decimal places based on magnitude', () => {
		expect(formatBytes(150_000_000_000)).toBe('150GB');
		expect(formatBytes(15_000_000_000)).toBe('15.0GB');
		expect(formatBytes(1_230_000_000)).toBe('1.23GB');
	});
});
