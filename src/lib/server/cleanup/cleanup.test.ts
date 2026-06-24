import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), delete: vi.fn() }
}));

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id', projectId: 'project_id', status: 'status', createdAt: 'created_at' },
	buildLogs: { deploymentId: 'deployment_id' },
	cronRuns: { startedAt: 'started_at' }
}));

vi.mock('drizzle-orm', () => ({
	isNotNull: vi.fn((col) => ({ op: 'isNotNull', col })),
	lt: vi.fn((_col, val) => ({ op: 'lt', val })),
	inArray: vi.fn((_col, vals) => ({ op: 'inArray', vals }))
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}));

import { db } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';
import { inArray } from 'drizzle-orm';
import { CleanupManager, getCleanupManager, parseDockerSize, formatBytes } from './index';

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};
const mockGetSetting = getSetting as ReturnType<typeof vi.fn>;
const mockInArray = inArray as ReturnType<typeof vi.fn>;

/* ── Helpers ──────────────────────────────────────────────────────── */

type MockDeployment = {
	id: string;
	projectId: string;
	status: string;
	createdAt: string;
};

function createSelectQuery(rows: MockDeployment[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(rows)
		})
	};
}

function setupDbMocks(oldDeployments: MockDeployment[] = [], allDeployments: MockDeployment[] = []) {
	mockDb.select.mockReset();
	mockDb.delete.mockReset();
	mockInArray.mockClear();

	mockDb.select
		.mockReturnValueOnce(createSelectQuery(oldDeployments))
		.mockReturnValueOnce(createSelectQuery(allDeployments));

	mockDb.delete.mockReturnValue({
		where: vi.fn().mockResolvedValue({ changes: oldDeployments.length })
	});
}

function mockDeployment(
	id: string,
	projectId = 'p-1',
	createdAt = '2025-01-01T00:00:00.000Z',
	status = 'failed'
) {
	return { id, projectId, status, createdAt };
}

function mockDeploymentRange(count: number, projectId = 'p-1') {
	return Array.from({ length: count }, (_, index) => {
		const day = String(index + 1).padStart(2, '0');
		return mockDeployment(`deploy-${index + 1}`, projectId, `2025-01-${day}T00:00:00.000Z`);
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

	it('runCleanup prunes logs for old deployments outside retained history', async () => {
		mockGetSetting.mockResolvedValue('7');
		const oldDeployments = mockDeploymentRange(18);
		setupDbMocks(oldDeployments, oldDeployments);

		const result = await manager.runCleanup();

		expect(result.deploymentsRemoved).toBe(0);
		expect(result.buildLogsRemoved).toBe(2);
		expect(mockInArray).toHaveBeenCalledWith('deployment_id', ['deploy-1', 'deploy-2']);
		/* 2 deletes: cronRuns cleanup + buildLogs */
		expect(mockDb.delete).toHaveBeenCalledTimes(2);
	});

	it('runCleanup preserves the latest 16 deployments per project', async () => {
		mockGetSetting.mockResolvedValue('7');
		const oldDeployments = mockDeploymentRange(20);
		setupDbMocks(oldDeployments, oldDeployments);

		const result = await manager.runCleanup();

		expect(result.deploymentsRemoved).toBe(0);
		expect(result.buildLogsRemoved).toBe(4);
		expect(mockInArray).toHaveBeenCalledWith('deployment_id', [
			'deploy-1',
			'deploy-2',
			'deploy-3',
			'deploy-4'
		]);
		expect(mockDb.delete).toHaveBeenCalledTimes(2);
	});

	it('runCleanup preserves the newest live deployment beyond the latest 16', async () => {
		mockGetSetting.mockResolvedValue('7');
		const oldDeployments = [
			mockDeployment('old-live', 'p-1', '2025-01-01T00:00:00.000Z', 'live'),
			mockDeployment('old-failed-1', 'p-1', '2025-01-02T00:00:00.000Z'),
			mockDeployment('old-failed-2', 'p-1', '2025-01-03T00:00:00.000Z'),
			...mockDeploymentRange(16, 'p-1').map((deployment, index) => ({
				...deployment,
				id: `recent-${index + 1}`,
				createdAt: `2025-01-${String(index + 4).padStart(2, '0')}T00:00:00.000Z`
			}))
		];
		setupDbMocks(oldDeployments, oldDeployments);

		const result = await manager.runCleanup();

		expect(result.deploymentsRemoved).toBe(0);
		expect(result.buildLogsRemoved).toBe(2);
		expect(mockInArray).toHaveBeenCalledWith('deployment_id', [
			'old-failed-1',
			'old-failed-2'
		]);
		expect(mockDb.delete).toHaveBeenCalledTimes(2);
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

describe('CleanupManager.getDockerDiskUsage', () => {
	let manager: CleanupManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new CleanupManager();
	});

	it('returns zeroed usage object when docker is unavailable', async () => {
		/* docker binary not available in test environment → falls through catch */
		const usage = await manager.getDockerDiskUsage();
		expect(usage).toMatchObject({
			images: { count: 0, sizeFormatted: '0 B' },
			containers: { count: 0, sizeFormatted: '0 B' },
			volumes: { count: 0, sizeFormatted: '0 B' },
			buildCache: { sizeFormatted: '0 B' },
			totalFormatted: '0 B'
		});
	});
});

describe('CleanupManager.dockerPrune', () => {
	let manager: CleanupManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new CleanupManager();
	});

	it('returns 0B spaceReclaimed when docker is unavailable', async () => {
		const result = await manager.dockerPrune('images');
		expect(result.type).toBe('images');
		expect(result.spaceReclaimed).toBe('0B');
	});

	it.each(['images', 'containers', 'volumes', 'buildcache', 'all'] as const)(
		'accepts prune type %s without throwing',
		async (type) => {
			const result = await manager.dockerPrune(type);
			expect(result.type).toBe(type);
		}
	);
});

describe('getCleanupManager singleton', () => {
	it('returns the same instance on repeated calls', () => {
		const a = getCleanupManager();
		const b = getCleanupManager();
		expect(a).toBe(b);
		a.stop();
	});
});
