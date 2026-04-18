import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const mockDb = {
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis()
	};
	mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
	});
	return { db: mockDb };
});

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id' },
	buildLogs: {}
}));

import { runRollback } from './rollback';
import type { RollbackConfig } from './rollback';
import type { CommandRunner, LogEntry } from './types';

function makeConfig(overrides?: Partial<RollbackConfig>): RollbackConfig {
	return {
		projectId: 'proj-1',
		projectSlug: 'my-app',
		imageTag: 'my-app:abc1234',
		commitSha: 'abc1234',
		port: 3001,
		domain: 'my-app.example.com',
		...overrides
	};
}

function makeSuccessRunner(): CommandRunner {
	return {
		async exec(cmd, args) {
			const joined = `${cmd} ${args.join(' ')}`;
			if (joined.includes('docker rename'))
				return { exitCode: 1, stdout: '', stderr: 'No such container' };
			if (joined.includes('docker run'))
				return { exitCode: 0, stdout: 'container123id\n', stderr: '' };
			return { exitCode: 0, stdout: '', stderr: '' };
		}
	};
}

function makeHealthyFetch(): typeof fetch {
	return vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
}

function makeCaddy() {
	return {
		addRoute: vi.fn().mockResolvedValue({ success: true }),
		removeRoute: vi.fn().mockResolvedValue({ success: true }),
		health: vi.fn().mockResolvedValue({ healthy: true }),
		ensureServer: vi.fn().mockResolvedValue({ success: true }),
		addWildcardRoute: vi.fn().mockResolvedValue({ success: true }),
		removeWildcardRoute: vi.fn().mockResolvedValue({ success: true }),
		listRoutes: vi.fn().mockResolvedValue([]),
		updateRoute: vi.fn().mockResolvedValue({ success: true })
	};
}

describe('runRollback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('succeeds with existing image (skips clone/detect/build)', async () => {
		const result = await runRollback(makeConfig(), makeSuccessRunner(), {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		expect(result.deploymentId).toBeTruthy();
		expect(result.imageTag).toBe('my-app:abc1234');
		expect(result.containerName).toBe('my-app');
		expect(result.commitSha).toBe('abc1234');
	});

	it('passes persistent volume to docker run', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('docker rename'))
					return { exitCode: 1, stdout: '', stderr: 'No such container' };
				if (joined.includes('docker run'))
					return { exitCode: 0, stdout: 'container123id\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		const runCall = calls.find((c) => c.includes('docker run'));
		expect(runCall).toContain('-v');
		expect(runCall).toContain('risved-proj-1-data:/app/data');
	});

	it('does not emit clone, detect, or build phases', async () => {
		const logs: LogEntry[] = [];
		await runRollback(makeConfig(), makeSuccessRunner(), {
			onLog: (entry) => logs.push(entry),
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		const phases = [...new Set(logs.map((l) => l.phase))];
		expect(phases).not.toContain('clone');
		expect(phases).not.toContain('detect');
		expect(phases).not.toContain('build');
		expect(phases).toContain('start');
		expect(phases).toContain('health');
		expect(phases).toContain('route');
		expect(phases).toContain('live');
	});

	it('calls caddy addRoute with domain and port', async () => {
		const caddy = makeCaddy();
		await runRollback(makeConfig({ domain: 'app.example.com', port: 3005 }), makeSuccessRunner(), {
			caddy: caddy as never,
			fetchFn: makeHealthyFetch()
		});

		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'app.example.com',
			port: 3005
		});
	});

	it('skips route when no domain', async () => {
		const caddy = makeCaddy();
		const result = await runRollback(
			makeConfig({ domain: undefined }),
			makeSuccessRunner(),
			{ caddy: caddy as never, fetchFn: makeHealthyFetch() }
		);

		expect(caddy.addRoute).not.toHaveBeenCalled();
		expect(result.success).toBe(true);
	});

	it('fails on docker run error', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				if (joined.includes('docker rename'))
					return { exitCode: 1, stdout: '', stderr: 'No such container' };
				if (joined.includes('docker run'))
					return { exitCode: 1, stdout: '', stderr: 'Cannot start' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Docker run failed');
	});

	it('fails on health check timeout', async () => {
		const failFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

		const result = await runRollback(makeConfig(), makeSuccessRunner(), {
			caddy: makeCaddy() as never,
			fetchFn: failFetch as unknown as typeof fetch,
			healthTimeoutMs: 300,
			healthIntervalMs: 50
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Health check timed out');
	});

	it('performs cutover when old container exists', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('docker rename')) return { exitCode: 0, stdout: '', stderr: '' };
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		const stopCalls = calls.filter((c) => c.includes('docker stop'));
		expect(stopCalls.length).toBeGreaterThanOrEqual(1);
	});

	it('restores old container on docker run failure', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('docker rename')) return { exitCode: 0, stdout: '', stderr: '' };
				if (joined.includes('docker run'))
					return { exitCode: 1, stdout: '', stderr: 'Failed' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		/* Second rename restores old container */
		const renameCalls = calls.filter((c) => c.includes('docker rename'));
		expect(renameCalls.length).toBe(2);
	});
});
