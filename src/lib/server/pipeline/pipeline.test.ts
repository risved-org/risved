import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const mockDb = {
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockResolvedValue([])
	};
	/* Make chaining work for insert().values() and update().set().where() */
	mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
	});
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue(
				Object.assign(Promise.resolve([]), {
					orderBy: vi.fn().mockResolvedValue([]),
					limit: vi.fn().mockResolvedValue([])
				})
			)
		})
	});
	return { db: mockDb };
});

vi.mock('$lib/server/db/schema', () => ({
	projects: {
		id: 'id',
		port: 'port',
		frameworkId: 'framework_id',
		tier: 'tier',
		updatedAt: 'updated_at'
	},
	deployments: { id: 'id' },
	buildLogs: {},
	envVars: { key: 'key', value: 'value', projectId: 'project_id' },
	domains: { hostname: 'hostname', projectId: 'project_id' }
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null)
}));

vi.mock('../git-token', () => ({
	resolveCloneToken: vi.fn().mockResolvedValue(null)
}));

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `encrypted:${v}`),
	safeDecrypt: vi.fn((v: string) => v)
}));

vi.mock('../detection', () => ({
	detectFramework: vi.fn(),
	createFsContext: vi.fn().mockReturnValue({})
}));

vi.mock('../dockerfile', () => ({
	generateDockerfile: vi
		.fn()
		.mockReturnValue({
			content: 'FROM node:20\nCMD ["node", "index.js"]',
			frameworkId: 'fresh',
			tier: 'deno'
		})
}));

vi.mock('node:fs/promises', () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockRejectedValue(new Error('no lockfile')),
	stat: vi.fn().mockRejectedValue(new Error('no lockfile'))
}));

import { runPipeline } from './index';
import { detectFramework } from '../detection';
import { resolveCloneToken } from '../git-token';
import { getSetting } from '$lib/server/settings';
import { db } from '$lib/server/db';
import type { CommandRunner, PipelineConfig } from './types';
import type { LogEntry } from './types';

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
	return {
		projectId: 'proj-1',
		projectSlug: 'my-app',
		repoUrl: 'https://github.com/user/repo.git',
		branch: 'main',
		port: 3001,
		domain: 'my-app.risved.example.com',
		...overrides
	};
}

function makeSuccessRunner(): CommandRunner {
	return {
		async exec(cmd, args) {
			const joined = `${cmd} ${args.join(' ')}`;
			if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
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
		addRedirectRoute: vi.fn().mockResolvedValue({ success: true }),
		listRoutes: vi.fn().mockResolvedValue([]),
		updateRoute: vi.fn().mockResolvedValue({ success: true })
	};
}

describe('runPipeline', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(detectFramework).mockResolvedValue({
			detected: true,
			framework: { id: 'fresh', name: 'Fresh', tier: 'deno', confidence: 'high' }
		});
	});

	it('runs all phases successfully', async () => {
		const caddy = makeCaddy();
		const result = await runPipeline(makeConfig(), makeSuccessRunner(), {
			caddy: caddy as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		expect(result.deploymentId).toBeTruthy();
		expect(result.commitSha).toBe('abc1234');
		expect(result.imageTag).toBe('my-app:abc1234');
		expect(result.containerName).toBe('my-app');
	});

	it('passes persistent volume to docker run', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker rename'))
					return { exitCode: 1, stdout: '', stderr: 'No such container' };
				if (joined.includes('docker run'))
					return { exitCode: 0, stdout: 'container123id\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		await runPipeline(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		const runCall = calls.find((c) => c.includes('docker run'));
		expect(runCall).toContain('-v');
		expect(runCall).toContain('risved-proj-1-data:/app/data');
	});

	it('does not attach managed Postgres network to Docker builds', async () => {
		const calls: string[] = []
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`
				calls.push(joined)
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' }
				if (joined.includes('docker inspect') && joined.includes('risved-postgres-proj-1')) {
					return { exitCode: 0, stdout: 'true\n', stderr: '' }
				}
				if (joined.includes('docker exec') && joined.includes('pg_isready')) {
					return { exitCode: 0, stdout: 'accepting connections', stderr: '' }
				}
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' }
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const result = await runPipeline(
			makeConfig({
				postgresEnabled: true,
				postgresPassword: 'encrypted:secret',
				releaseCommand: 'bun run db:migrate'
			}),
			runner,
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		)

		expect(result.success).toBe(true)
		const buildCalls = calls.filter((c) => c.includes('docker build'))
		expect(buildCalls).toHaveLength(2)
		expect(buildCalls.every((c) => !c.includes('--network'))).toBe(true)
		const runtimeRun = calls.find((c) => c.includes('docker run') && !c.includes('risved-release'))
		expect(runtimeRun).toContain('--network risved')
		const releaseRun = calls.find((c) => c.includes('docker run') && c.includes('risved-release'))
		expect(releaseRun).toContain('--network risved')
	});

	it('emits logs for each phase', async () => {
		const logs: LogEntry[] = [];
		const result = await runPipeline(makeConfig(), makeSuccessRunner(), {
			onLog: (entry) => logs.push(entry),
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		const phases = [...new Set(logs.map((l) => l.phase))];
		expect(phases).toContain('clone');
		expect(phases).toContain('detect');
		expect(phases).toContain('build');
		expect(phases).toContain('start');
		expect(phases).toContain('health');
		expect(phases).toContain('route');
		expect(phases).toContain('live');
		expect(result.logs.length).toBe(logs.length);
	});

	it('calls caddy addRoute with domain and port', async () => {
		const caddy = makeCaddy();
		await runPipeline(makeConfig({ domain: 'app.example.com', port: 3005 }), makeSuccessRunner(), {
			caddy: caddy as never,
			fetchFn: makeHealthyFetch()
		});

		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'app.example.com',
			port: 3005
		});
	});

	it('skips route phase when no domain', async () => {
		const caddy = makeCaddy();
		const result = await runPipeline(makeConfig({ domain: undefined }), makeSuccessRunner(), {
			caddy: caddy as never,
			fetchFn: makeHealthyFetch()
		});

		expect(caddy.addRoute).not.toHaveBeenCalled();
		expect(result.success).toBe(true);
		const routeLog = result.logs.find((l) => l.phase === 'route');
		expect(routeLog?.message).toContain('skipping');
	});

	it('fails on clone error', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				if (args.includes('clone'))
					return { exitCode: 128, stdout: '', stderr: 'fatal: not found' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Git clone failed');
	});

	it('fails when framework detection fails', async () => {
		vi.mocked(detectFramework).mockResolvedValue({ detected: false, framework: null });

		const result = await runPipeline(makeConfig(), makeSuccessRunner(), {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Could not detect framework');
	});

	it('fails on docker build error', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker build'))
					return { exitCode: 1, stdout: '', stderr: 'Build failed' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Docker build failed');
	});

	it('fails on health check timeout and rolls back', async () => {
		const failFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker rename'))
					return { exitCode: 1, stdout: '', stderr: 'No such container' };
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: failFetch as unknown as typeof fetch,
			healthTimeoutMs: 300,
			healthIntervalMs: 50
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Health check timed out');
		/* Should stop the failed new container */
		expect(calls.some((c) => c.includes('docker stop'))).toBe(true);
	});

	it('falls back to saved framework when detection fails', async () => {
		vi.mocked(detectFramework).mockResolvedValueOnce({ detected: false, framework: null });
		const result = await runPipeline(
			makeConfig({ frameworkId: 'hono', tier: 'deno' }),
			makeSuccessRunner(),
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(true);
		const detectLog = result.logs.find(
			(l) => l.phase === 'detect' && l.message.includes('Using saved')
		);
		expect(detectLog?.message).toContain('hono');
	});

	it('frees port before starting new container', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				/* docker ps --filter publish= returns an existing container */
				if (joined.includes('docker ps') && joined.includes('--filter')) return { exitCode: 0, stdout: 'abc123def456\n', stderr: '' };
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		/* Should force-remove containers on the port before docker run */
		const rmCalls = calls.filter((c) => c.includes('docker rm -f'));
		expect(rmCalls.length).toBeGreaterThanOrEqual(1);
		/* docker run should come after the rm */
		const rmIdx = calls.findIndex((c) => c.includes('docker rm -f abc123def456'));
		const runIdx = calls.findIndex((c) => c.includes('docker run'));
		expect(rmIdx).toBeLessThan(runIdx);
	});

	it('skips the release phase when releaseCommand is null', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker run'))
					return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(
			makeConfig({ releaseCommand: null }),
			runner,
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(true);
		/* No `--target build` invocations means the release runner never fired. */
		expect(calls.some((c) => c.includes('--target') && c.includes('build'))).toBe(false);
		expect(result.logs.some((l) => l.phase === 'release')).toBe(false);
	});

	it('runs the release phase after build and before start when releaseCommand is set', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker run'))
					return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(
			makeConfig({ releaseCommand: 'bun run migrate' }),
			runner,
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(true);
		/* The release flow: docker build --target build → docker run for the release image. */
		const buildIdx = calls.findIndex((c) => c.includes('docker build') && !c.includes('--target'));
		const releaseBuildIdx = calls.findIndex(
			(c) => c.includes('docker build') && c.includes('--target') && c.includes('build')
		);
		const releaseRunIdx = calls.findIndex(
			(c) => c.includes('docker run') && c.includes('risved-release')
		);
		const startIdx = calls.findIndex(
			(c) => c.includes('docker run') && !c.includes('risved-release')
		);
		expect(buildIdx).toBeGreaterThanOrEqual(0);
		expect(releaseBuildIdx).toBeGreaterThan(buildIdx);
		expect(releaseRunIdx).toBeGreaterThan(releaseBuildIdx);
		expect(startIdx).toBeGreaterThan(releaseRunIdx);
		expect(result.logs.some((l) => l.phase === 'release')).toBe(true);
	});

	it('fails the deploy when the release command exits non-zero and does not start the runtime container', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker run') && joined.includes('risved-release')) {
					return { exitCode: 1, stdout: '', stderr: 'migration failed' };
				}
				if (joined.includes('docker run'))
					return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(
			makeConfig({ releaseCommand: 'bun run migrate' }),
			runner,
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Release command failed');
		/* The runtime container must NOT have been started — old version keeps serving. */
		const runtimeRun = calls.find(
			(c) => c.includes('docker run') && !c.includes('risved-release')
		);
		expect(runtimeRun).toBeUndefined();
		const failureLog = result.logs.find((l) => l.phase === 'release' && l.level === 'error');
		expect(failureLog).toBeTruthy();
	});

	it('each log entry has timestamp, phase, level, and message', async () => {
		const result = await runPipeline(makeConfig(), makeSuccessRunner(), {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		for (const entry of result.logs) {
			expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/);
			expect(entry.phase).toBeTruthy();
			expect(entry.level).toBeTruthy();
			expect(entry.message).toBeTruthy();
		}
	});

	it('injects HTTPS token into clone URL when gitConnectionId is provided', async () => {
		vi.mocked(resolveCloneToken).mockResolvedValueOnce('ghp_test_token');

		const cloneUrls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				if (args.includes('clone')) {
					// args[1] is the URL
					const urlArg = args.find((a) => a.startsWith('https://'));
					if (urlArg) cloneUrls.push(urlArg);
				}
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(
			makeConfig({ gitConnectionId: 'conn-1' }),
			runner,
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(true);
		expect(resolveCloneToken).toHaveBeenCalledWith('conn-1');
		expect(cloneUrls.some((u) => u.includes('x-access-token') && u.includes('ghp_test_token'))).toBe(true);
	});

	it('configures routes for custom domains and adds www redirect', async () => {
		const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> };

		// Override db.select so the domains query returns custom domains
		mockDb.select
			// First call: envVars query (returns empty)
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([])
				})
			})
			// Second call: domains query (returns two custom domains)
			.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([
						{ hostname: 'custom.example.com' },
						{ hostname: 'www.custom.example.com' }
					])
				})
			});

		const caddy = makeCaddy();
		const result = await runPipeline(makeConfig(), makeSuccessRunner(), {
			caddy: caddy as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		expect(caddy.addRoute).toHaveBeenCalledWith(
			expect.objectContaining({ hostname: 'custom.example.com' })
		);
		expect(caddy.addRoute).toHaveBeenCalledWith(
			expect.objectContaining({ hostname: 'www.custom.example.com' })
		);
	});

	it('configures alt control-plane route when hostname is set', async () => {
		// getSetting is called twice: first for ssh_deploy_private_key, then for hostname
		vi.mocked(getSetting)
			.mockResolvedValueOnce(null) // ssh key
			.mockResolvedValueOnce('panel.example.com'); // hostname

		const caddy = makeCaddy();
		const result = await runPipeline(
			makeConfig({ domain: 'app.otherdomain.com' }),
			makeSuccessRunner(),
			{ caddy: caddy as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(true);
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'my-app.panel.example.com',
			port: 3001
		});
	});
});
