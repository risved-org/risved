import { describe, it, expect, vi } from 'vitest';
import {
	dockerBuild,
	dockerRun,
	dockerStop,
	getCommitSha,
	gitClone,
	waitForHealthy
} from './docker';
import type { CommandRunner } from './types';

function mockRunner(
	responses: Record<string, { exitCode: number; stdout: string; stderr: string }>
): CommandRunner {
	return {
		async exec(cmd, args) {
			const key = `${cmd} ${args.join(' ')}`;
			for (const [pattern, response] of Object.entries(responses)) {
				if (key.includes(pattern)) return response;
			}
			return { exitCode: 0, stdout: '', stderr: '' };
		}
	};
}

describe('gitClone', () => {
	it('runs git clone with --depth 1 and branch', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await gitClone(runner, 'https://github.com/user/repo.git', 'main', '/tmp/dest');
		expect(result.success).toBe(true);
		expect(calls[0]).toEqual([
			'git',
			'clone',
			'--depth',
			'1',
			'--branch',
			'main',
			'https://github.com/user/repo.git',
			'/tmp/dest'
		]);
	});

	it('returns error on failure', async () => {
		const runner = mockRunner({
			'git clone': { exitCode: 128, stdout: '', stderr: 'fatal: repository not found' }
		});

		const result = await gitClone(runner, 'bad-url', 'main', '/tmp/dest');
		expect(result.success).toBe(false);
		expect(result.error).toContain('repository not found');
	});
});

describe('getCommitSha', () => {
	it('returns trimmed short SHA', async () => {
		const runner = mockRunner({
			'git rev-parse': { exitCode: 0, stdout: 'abc1234\n', stderr: '' }
		});

		const sha = await getCommitSha(runner, '/tmp/repo');
		expect(sha).toBe('abc1234');
	});

	it('returns null on failure', async () => {
		const runner = mockRunner({
			'git rev-parse': { exitCode: 1, stdout: '', stderr: 'not a git repo' }
		});

		const sha = await getCommitSha(runner, '/tmp/bad');
		expect(sha).toBeNull();
	});
});

describe('dockerBuild', () => {
	it('builds with correct args', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await dockerBuild(runner, {
			contextDir: '/tmp/ctx',
			imageTag: 'myapp:abc1234'
		});

		expect(result.success).toBe(true);
		expect(calls[0]).toContain('myapp:abc1234');
		expect(calls[0]).toContain('/tmp/ctx');
		expect(calls[0]).not.toContain('--network');
	});

	it('returns error on build failure', async () => {
		const runner = mockRunner({
			'docker build': { exitCode: 1, stdout: '', stderr: 'COPY failed' }
		});

		const result = await dockerBuild(runner, {
			contextDir: '/tmp/ctx',
			imageTag: 'app:v1'
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('COPY failed');
	});
});

describe('dockerRun', () => {
	it('runs with correct args and port mapping', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: 'a1b2c3d4e5f6containerid\n', stderr: '' };
			}
		};

		const result = await dockerRun(runner, {
			imageTag: 'myapp:abc',
			containerName: 'myapp',
			port: 3001
		});

		expect(result.success).toBe(true);
		expect(result.containerId).toBe('a1b2c3d4e5f6');
		expect(calls[0]).toContain('-d');
		expect(calls[0]).toContain('--network');
		expect(calls[0]).toContain('risved');
		expect(calls[0]).toContain('--name');
		expect(calls[0]).toContain('myapp');
		expect(calls[0]).toContain('3001:3000');
	});

	it('passes environment variables', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: 'containerid\n', stderr: '' };
			}
		};

		await dockerRun(runner, {
			imageTag: 'myapp:abc',
			containerName: 'myapp',
			port: 3001,
			env: { NODE_ENV: 'production', PORT: '3000' }
		});

		expect(calls[0]).toContain('-e');
		expect(calls[0]).toContain('NODE_ENV=production');
		expect(calls[0]).toContain('PORT=3000');
	});

	it('returns error on run failure', async () => {
		const runner = mockRunner({
			'docker run': { exitCode: 125, stdout: '', stderr: 'port already in use' }
		});

		const result = await dockerRun(runner, {
			imageTag: 'app:v1',
			containerName: 'app',
			port: 3001
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('port already in use');
	});
});

describe('dockerStop', () => {
	it('stops and removes container', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await dockerStop(runner, 'myapp', 10);
		expect(result.success).toBe(true);
		expect(calls[0]).toEqual(['docker', 'stop', '-t', '10', 'myapp']);
		expect(calls[1]).toEqual(['docker', 'rm', '-f', 'myapp']);
	});

	it('succeeds if container does not exist', async () => {
		const runner = mockRunner({
			'docker stop': { exitCode: 1, stdout: '', stderr: 'No such container' },
			'docker rm': { exitCode: 1, stdout: '', stderr: 'No such container' }
		});

		const result = await dockerStop(runner, 'nonexistent');
		expect(result.success).toBe(true);
	});
});

describe('waitForHealthy', () => {
	it('returns true when endpoint responds with 200', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		const result = await waitForHealthy(3001, 5000, 100, mockFetch as unknown as typeof fetch);
		expect(result).toBe(true);
		expect(mockFetch).toHaveBeenCalled();
	});

	it('returns true on non-5xx responses (e.g. 404)', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
		const result = await waitForHealthy(3001, 5000, 100, mockFetch as unknown as typeof fetch);
		expect(result).toBe(true);
	});

	it('retries on 500 errors', async () => {
		let callCount = 0;
		const mockFetch = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount < 3) return Promise.resolve({ ok: false, status: 500 });
			return Promise.resolve({ ok: true, status: 200 });
		});

		const result = await waitForHealthy(3001, 5000, 50, mockFetch as unknown as typeof fetch);
		expect(result).toBe(true);
		expect(callCount).toBeGreaterThanOrEqual(3);
	});

	it('returns false on timeout', async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
		const result = await waitForHealthy(3001, 300, 100, mockFetch as unknown as typeof fetch);
		expect(result).toBe(false);
	});
});
