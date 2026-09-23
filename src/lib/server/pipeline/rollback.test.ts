import { describe, it, expect, vi, beforeEach } from 'vitest';

const { envRows } = vi.hoisted(() => ({
	envRows: { value: [] as Array<{ key: string; value: string }> }
}));

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
	Object.assign(mockDb, {
		select: vi.fn(() => ({
			from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(envRows.value)) }))
		}))
	});
	return { db: mockDb };
});

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' },
	deployments: { id: 'id' },
	buildLogs: {},
	envVars: { key: 'key', value: 'value', projectId: 'project_id' }
}));

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `encrypted:${v}`),
	safeDecrypt: vi.fn((v: string) => v.replace(/^encrypted:/, ''))
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null)
}));

vi.mock('./supersede', () => ({
	supersedeLiveDeployments: vi.fn().mockResolvedValue(undefined)
}));

import { runRollback } from './rollback';
import { supersedeLiveDeployments } from './supersede';
import type { RollbackConfig } from './rollback';
import type { CommandRunner, LogEntry } from './types';
import { getSetting } from '$lib/server/settings';

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
		envRows.value = [];
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

	it('passes decrypted project env vars to docker run', async () => {
		envRows.value = [
			{ key: 'API_KEY', value: 'encrypted:s3cret' },
			{ key: 'PUBLIC_URL', value: 'encrypted:https://my-app.example.com' }
		];

		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				if (args[0] === 'run') return { exitCode: 0, stdout: 'container123id\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		const runCall = calls.find((c) => c[0] === 'docker' && c[1] === 'run');
		expect(runCall).toContain('API_KEY=s3cret');
		expect(runCall).toContain('PUBLIC_URL=https://my-app.example.com');
		expect(runCall?.some((a) => a.startsWith('DATABASE_URL='))).toBe(false);
	});

	it('merges managed Postgres env when postgres is enabled', async () => {
		envRows.value = [{ key: 'API_KEY', value: 'encrypted:s3cret' }];

		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				if (args[0] === 'run') return { exitCode: 0, stdout: 'container123id\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		await runRollback(
			makeConfig({ postgresEnabled: true, postgresPassword: 'encrypted:pgpass' }),
			runner,
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		const runCall = calls.find((c) => c[0] === 'docker' && c[1] === 'run');
		expect(runCall).toContain('API_KEY=s3cret');
		expect(runCall).toContain('POSTGRES_PASSWORD=pgpass');
		expect(runCall).toContain('PGHOST=risved-postgres-proj-1');
		const dbUrl = runCall?.find((a) => a.startsWith('DATABASE_URL='));
		expect(dbUrl).toContain(':pgpass@risved-postgres-proj-1:5432/');
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

	it('removes existing container before starting the rollback container', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		const rmIdx = calls.findIndex((c) => c.includes('docker rm -f my-app'));
		const runIdx = calls.findIndex((c) => c.includes('docker run'));
		expect(rmIdx).toBeGreaterThanOrEqual(0);
		expect(runIdx).toBeGreaterThan(rmIdx);
	});

	it('emits a log when freePort removes containers', async () => {
		const logs: LogEntry[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				/* docker ps -q returns one container ID */
				if (joined.includes('docker ps') && args.includes('-q')) {
					return { exitCode: 0, stdout: 'stale123\n', stderr: '' };
				}
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'newcid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		await runRollback(makeConfig(), runner, {
			onLog: (entry) => logs.push(entry),
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		const freePortLog = logs.find((l) => l.message.includes('occupying port'));
		expect(freePortLog).toBeDefined();
	});

	it('emits a warning when caddy addRoute fails', async () => {
		const logs: LogEntry[] = [];
		const caddy = {
			...makeCaddy(),
			addRoute: vi.fn().mockResolvedValue({ success: false, error: 'caddy unavailable' })
		};

		const result = await runRollback(makeConfig({ domain: 'app.example.com' }), makeSuccessRunner(), {
			onLog: (entry) => logs.push(entry),
			caddy: caddy as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		const warnLog = logs.find((l) => l.level === 'warn' && l.message.includes('route update failed'));
		expect(warnLog).toBeDefined();
	});

	it('falls back to a default caddy client and fetch when not provided', async () => {
		const result = await runRollback(makeConfig({ domain: undefined }), makeSuccessRunner(), {
			healthTimeoutMs: 100,
			healthIntervalMs: 20
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Health check timed out');
	}, 10000);

	it('uses a default phase when a non-rollback error is thrown', async () => {
		const { db } = await import('$lib/server/db');
		vi.mocked(db.update).mockImplementationOnce(() => {
			throw new Error('unexpected db error');
		});

		const logs: LogEntry[] = [];
		const result = await runRollback(makeConfig(), makeSuccessRunner(), {
			onLog: (entry) => logs.push(entry),
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		expect(result.error).toBe('unexpected db error');
		const errorLog = logs.find((l) => l.level === 'error');
		expect(errorLog?.phase).toBe('start');
	});

	it('adds alt route when hostname setting is set and domain differs', async () => {
		vi.mocked(getSetting).mockResolvedValue(JSON.stringify({
			mode: 'subdomain',
			baseDomain: 'example.com',
			prefix: 'host'
		}))

		const caddy = makeCaddy();
		await runRollback(
			makeConfig({ domain: 'app.custom.com', projectSlug: 'my-app', port: 3001 }),
			makeSuccessRunner(),
			{ caddy: caddy as never, fetchFn: makeHealthyFetch() }
		);

		const routeCalls = caddy.addRoute.mock.calls.map((c) => c[0].hostname);
		expect(routeCalls).toContain('my-app.example.com');
	});

	it('emits warning when alt route fails', async () => {
		vi.mocked(getSetting).mockResolvedValue(JSON.stringify({
			mode: 'subdomain',
			baseDomain: 'example.com',
			prefix: 'host'
		}))

		const logs: LogEntry[] = [];
		let altCall = 0;
		const caddy = {
			...makeCaddy(),
			addRoute: vi.fn().mockImplementation(() => {
				altCall++
				/* primary route succeeds, alt route fails */
				if (altCall === 2) return Promise.resolve({ success: false, error: 'alt fail' })
				return Promise.resolve({ success: true })
			})
		};

		await runRollback(
			makeConfig({ domain: 'app.custom.com', projectSlug: 'my-app' }),
			makeSuccessRunner(),
			{ onLog: (e) => logs.push(e), caddy: caddy as never, fetchFn: makeHealthyFetch() }
		);

		const warnLog = logs.find((l) => l.level === 'warn' && l.message.includes('alt route failed'));
		expect(warnLog).toBeDefined();
	});

	it('omits commitSha when config.commitSha is null', async () => {
		const result = await runRollback(makeConfig({ commitSha: null }), makeSuccessRunner(), {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		expect(result.commitSha).toBeUndefined();
	});

	it('falls back to start phase and generic message for a non-Error throw', async () => {
		const caddy = {
			...makeCaddy(),
			addRoute: vi.fn().mockRejectedValue('caddy exploded')
		};

		const result = await runRollback(
			makeConfig({ domain: 'app.example.com' }),
			makeSuccessRunner(),
			{ caddy: caddy as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Unknown error');
	});
});

describe('runRollback supersedes the previous live deployment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		envRows.value = [];
	});

	it('demotes the previously live deployment once the rollback is live', async () => {
		const result = await runRollback(makeConfig(), makeSuccessRunner(), {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		expect(supersedeLiveDeployments).toHaveBeenCalledWith('proj-1', 'my-app', result.deploymentId);
	});

	it('leaves the previous deployment live when the rollback fails', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				if (joined.includes('docker run')) return { exitCode: 1, stdout: '', stderr: 'boom' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runRollback(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		expect(supersedeLiveDeployments).not.toHaveBeenCalled();
	});
});
