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
	envVars: { key: 'key', value: 'value', projectId: 'project_id' }
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null)
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
	rm: vi.fn().mockResolvedValue(undefined)
}));

import { runPipeline } from './index';
import { detectFramework } from '../detection';
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
		expect(phases).toContain('cutover');
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

	it('uses override framework when provided', async () => {
		const result = await runPipeline(
			makeConfig({ frameworkId: 'hono', tier: 'deno' }),
			makeSuccessRunner(),
			{ caddy: makeCaddy() as never, fetchFn: makeHealthyFetch() }
		);

		expect(result.success).toBe(true);
		expect(detectFramework).not.toHaveBeenCalled();
	});

	it('performs cutover when old container exists', async () => {
		const calls: string[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.includes('rev-parse')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
				/* Rename succeeds = old container exists */
				if (joined.includes('docker rename')) return { exitCode: 0, stdout: '', stderr: '' };
				if (joined.includes('docker run')) return { exitCode: 0, stdout: 'cid\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await runPipeline(makeConfig(), runner, {
			caddy: makeCaddy() as never,
			fetchFn: makeHealthyFetch()
		});

		expect(result.success).toBe(true);
		/* Should stop old container during cutover */
		const stopCalls = calls.filter((c) => c.includes('docker stop'));
		expect(stopCalls.length).toBeGreaterThanOrEqual(1);
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
});
