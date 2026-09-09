import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), update: vi.fn() }
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' },
	deployments: {
		projectId: 'project_id',
		status: 'status',
		imageTag: 'image_tag',
		createdAt: 'created_at'
	}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((_col, val) => ({ op: 'eq', val })),
	isNotNull: vi.fn((col) => ({ op: 'isNotNull', col })),
	inArray: vi.fn((_col, vals) => ({ op: 'inArray', vals }))
}));

import { db } from '$lib/server/db';
import { inArray } from 'drizzle-orm';
import {
	getDiskSpace,
	isDiskLow,
	pruneProjectImages,
	pruneControlPlaneImages,
	pruneDockerResources,
	LOW_DISK_FREE_BYTES
} from './docker-prune';
import type { CommandRunner } from '$lib/server/pipeline/types';

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
};
const mockInArray = inArray as ReturnType<typeof vi.fn>;

/* ── Helpers ──────────────────────────────────────────────────────── */

type Project = { id: string; slug: string };
type Deployment = { projectId: string; status: string; imageTag: string | null; createdAt: string };

function setupDb(projectRows: Project[], deploymentRows: Deployment[]) {
	mockDb.select.mockReset();
	mockDb.update.mockReset();
	mockInArray.mockClear();

	/* Project query: awaited directly or via .where() */
	const projectQuery = Object.assign(Promise.resolve(projectRows), {
		where: vi.fn().mockResolvedValue(projectRows)
	});
	mockDb.select
		.mockReturnValueOnce({ from: vi.fn().mockReturnValue(projectQuery) })
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(deploymentRows) })
		});

	const where = vi.fn().mockResolvedValue(undefined);
	mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
	return { projectQuery };
}

function makeRunner(images: string[], inUse: string[] = []) {
	const calls: string[] = [];
	const runner: CommandRunner = {
		async exec(cmd, args) {
			const joined = `${cmd} ${args.join(' ')}`;
			calls.push(joined);
			if (joined.startsWith('docker images')) {
				return { exitCode: 0, stdout: images.join('\n') + '\n', stderr: '' };
			}
			if (joined.startsWith('docker rmi')) {
				const tag = args[1];
				return inUse.includes(tag)
					? { exitCode: 1, stdout: '', stderr: 'image is being used by running container' }
					: { exitCode: 0, stdout: `Untagged: ${tag}\n`, stderr: '' };
			}
			if (joined.startsWith('docker image prune')) {
				return { exitCode: 0, stdout: 'Total reclaimed space: 1.2GB\n', stderr: '' };
			}
			if (joined.startsWith('docker builder prune')) {
				return { exitCode: 0, stdout: 'Total reclaimed space: 3.4GB\n', stderr: '' };
			}
			return { exitCode: 0, stdout: '', stderr: '' };
		}
	};
	return { runner, calls };
}

function dep(projectId: string, imageTag: string, createdAt: string, status = 'live'): Deployment {
	return { projectId, imageTag, createdAt, status };
}

/* ── getDiskSpace ─────────────────────────────────────────────────── */

describe('getDiskSpace', () => {
	it('parses POSIX df output', async () => {
		const runner: CommandRunner = {
			async exec() {
				return {
					exitCode: 0,
					stdout:
						'Filesystem     1024-blocks     Used Available Capacity Mounted on\n' +
						'/dev/sda1         40000000 36000000   4000000      90% /\n',
					stderr: ''
				};
			}
		};
		const space = await getDiskSpace(runner);
		expect(space).not.toBeNull();
		expect(space!.totalBytes).toBe(40000000 * 1024);
		expect(space!.freeBytes).toBe(4000000 * 1024);
		expect(space!.freePercent).toBeCloseTo(10);
	});

	it('probes the bind-mounted data path by default', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 1, stdout: '', stderr: 'No such file' };
			}
		};
		await getDiskSpace(runner);
		expect(calls[0]).toEqual(['df', '-kP', '/app/data']);
	});

	it('returns null when df fails or output is unparseable', async () => {
		const failing: CommandRunner = {
			async exec() {
				return { exitCode: 1, stdout: '', stderr: 'No such file' };
			}
		};
		expect(await getDiskSpace(failing)).toBeNull();

		const empty: CommandRunner = {
			async exec() {
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};
		expect(await getDiskSpace(empty)).toBeNull();
	});
});

describe('isDiskLow', () => {
	it('flags low free percentage', () => {
		expect(isDiskLow({ totalBytes: 100e9, freeBytes: 10e9, freePercent: 10 })).toBe(true);
	});

	it('flags low absolute free bytes even with a healthy percentage', () => {
		expect(
			isDiskLow({ totalBytes: 20e9, freeBytes: LOW_DISK_FREE_BYTES - 1, freePercent: 25 })
		).toBe(true);
	});

	it('accepts plenty of free space', () => {
		expect(isDiskLow({ totalBytes: 40e9, freeBytes: 20e9, freePercent: 50 })).toBe(false);
	});
});

/* ── pruneProjectImages ───────────────────────────────────────────── */

describe('pruneProjectImages', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('removes images beyond the newest successful deployments per project', async () => {
		setupDb(
			[{ id: 'p1', slug: 'my-app' }],
			[
				dep('p1', 'my-app:sha1', '2025-01-01T00:00:00Z', 'stopped'),
				dep('p1', 'my-app:sha2', '2025-01-02T00:00:00Z', 'stopped'),
				dep('p1', 'my-app:sha3', '2025-01-03T00:00:00Z', 'stopped'),
				dep('p1', 'my-app:sha4', '2025-01-04T00:00:00Z', 'stopped'),
				dep('p1', 'my-app:sha5', '2025-01-05T00:00:00Z', 'live')
			]
		);
		const { runner, calls } = makeRunner([
			'my-app:sha1',
			'my-app:sha2',
			'my-app:sha3',
			'my-app:sha4',
			'my-app:sha5'
		]);

		const removed = await pruneProjectImages(runner, 3);

		expect(removed.sort()).toEqual(['my-app:sha1', 'my-app:sha2']);
		expect(calls.filter((c) => c.startsWith('docker rmi')).sort()).toEqual([
			'docker rmi my-app:sha1',
			'docker rmi my-app:sha2'
		]);
		expect(mockInArray).toHaveBeenCalledWith('image_tag', expect.arrayContaining(removed));
	});

	it('always keeps the live image even when it is older than the keep window', async () => {
		setupDb(
			[{ id: 'p1', slug: 'my-app' }],
			[
				dep('p1', 'my-app:old-live', '2025-01-01T00:00:00Z', 'live'),
				dep('p1', 'my-app:s2', '2025-01-02T00:00:00Z', 'stopped'),
				dep('p1', 'my-app:s3', '2025-01-03T00:00:00Z', 'stopped')
			]
		);
		const { runner } = makeRunner(['my-app:old-live', 'my-app:s2', 'my-app:s3']);

		const removed = await pruneProjectImages(runner, 1);

		expect(removed).toEqual(['my-app:s2']);
	});

	it('ignores failed deployments when choosing what to keep', async () => {
		setupDb(
			[{ id: 'p1', slug: 'my-app' }],
			[
				dep('p1', 'my-app:good', '2025-01-01T00:00:00Z', 'stopped'),
				dep('p1', 'my-app:bad', '2025-01-02T00:00:00Z', 'failed')
			]
		);
		const { runner } = makeRunner(['my-app:good', 'my-app:bad']);

		const removed = await pruneProjectImages(runner, 1);

		expect(removed).toEqual(['my-app:bad']);
	});

	it('only touches images that belong to a project (including PR previews)', async () => {
		setupDb([{ id: 'p1', slug: 'my-app' }], [dep('p1', 'my-app:live', '2025-01-05T00:00:00Z')]);
		const { runner, calls } = makeRunner([
			'my-app:live',
			'my-app:stale',
			'my-app:stale-release',
			'my-app-pr-7:abc',
			'my-application:other',
			'postgres:17',
			'risved-node-build:22',
			'ghcr.io/risved-org/risved:v0.13.11'
		]);

		const removed = await pruneProjectImages(runner, 3);

		expect(removed.sort()).toEqual(['my-app-pr-7:abc', 'my-app:stale', 'my-app:stale-release']);
		expect(calls.some((c) => c.includes('postgres'))).toBe(false);
		expect(calls.some((c) => c.includes('risved-node-build'))).toBe(false);
		expect(calls.some((c) => c.includes('my-application'))).toBe(false);
	});

	it('leaves images Docker refuses to remove and does not clear their tags', async () => {
		setupDb([{ id: 'p1', slug: 'my-app' }], []);
		const { runner } = makeRunner(['my-app:running', 'my-app:stale'], ['my-app:running']);

		const removed = await pruneProjectImages(runner, 3);

		expect(removed).toEqual(['my-app:stale']);
		expect(mockInArray).toHaveBeenCalledWith('image_tag', ['my-app:stale']);
	});

	it('scopes to a single project when a projectId is given', async () => {
		const { projectQuery } = setupDb(
			[{ id: 'p1', slug: 'my-app' }],
			[dep('p2', 'other-app:x', '2025-01-01T00:00:00Z')]
		);
		const { runner, calls } = makeRunner(['my-app:stale', 'other-app:stale']);

		const removed = await pruneProjectImages(runner, 3, 'p1');

		expect(projectQuery.where).toHaveBeenCalled();
		expect(removed).toEqual(['my-app:stale']);
		expect(calls.some((c) => c.includes('other-app'))).toBe(false);
	});

	it('does nothing when there are no projects or no images', async () => {
		setupDb([], []);
		const { runner, calls } = makeRunner(['my-app:stale']);
		expect(await pruneProjectImages(runner)).toEqual([]);
		expect(calls).toEqual([]);

		setupDb([{ id: 'p1', slug: 'my-app' }], []);
		const empty = makeRunner([]);
		expect(await pruneProjectImages(empty.runner)).toEqual([]);
		expect(mockDb.update).not.toHaveBeenCalled();
	});
});

/* ── pruneControlPlaneImages ──────────────────────────────────────── */

describe('pruneControlPlaneImages', () => {
	it('removes control-plane images that are not in use and nothing else', async () => {
		const { runner, calls } = makeRunner(
			[
				'ghcr.io/risved-org/risved:0.13.5',
				'ghcr.io/risved-org/risved:0.13.10',
				'risved-node-build:22',
				'docker:cli',
				'my-app:live'
			],
			['ghcr.io/risved-org/risved:0.13.10']
		);

		const removed = await pruneControlPlaneImages(runner);

		expect(removed).toEqual(['ghcr.io/risved-org/risved:0.13.5']);
		expect(calls.filter((c) => c.startsWith('docker rmi'))).toEqual([
			'docker rmi ghcr.io/risved-org/risved:0.13.5',
			'docker rmi ghcr.io/risved-org/risved:0.13.10'
		]);
	});
});

/* ── pruneDockerResources ─────────────────────────────────────────── */

describe('pruneDockerResources', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('trims the build cache and prunes dangling images by default', async () => {
		setupDb([], []);
		const { runner, calls } = makeRunner(['ghcr.io/risved-org/risved:0.13.5']);

		const summary = await pruneDockerResources(runner);

		expect(summary.imagesRemoved).toEqual(['ghcr.io/risved-org/risved:0.13.5']);
		expect(calls).toContain('docker image prune -f');
		expect(calls).toContain('docker builder prune -f --keep-storage 2GB');
		expect(summary.danglingReclaimed).toBe('1.2GB');
		expect(summary.buildCacheReclaimed).toBe('3.4GB');
	});

	it('drops the whole build cache when aggressive', async () => {
		setupDb([], []);
		const { runner, calls } = makeRunner([]);

		await pruneDockerResources(runner, { aggressive: true });

		expect(calls).toContain('docker builder prune -af');
		expect(calls.some((c) => c.includes('--keep-storage'))).toBe(false);
	});

	it('never prunes containers or volumes', async () => {
		setupDb([], []);
		const { runner, calls } = makeRunner([]);

		await pruneDockerResources(runner, { aggressive: true });

		expect(calls.some((c) => c.includes('container prune'))).toBe(false);
		expect(calls.some((c) => c.includes('volume'))).toBe(false);
		expect(calls.some((c) => c.includes('system prune'))).toBe(false);
	});
});
