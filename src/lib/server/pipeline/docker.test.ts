import { describe, it, expect, vi } from 'vitest';
import {
	dockerBuild,
	dockerRun,
	dockerStop,
	dockerVolumeRemove,
	ensureWarmImage,
	freePort,
	getContainerLogs,
	projectVolumeName,
	toSshUrl,
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
			'--single-branch',
			'--branch',
			'main',
			'https://github.com/user/repo.git',
			'/tmp/dest'
		]);
	});

	it('checks out a rebuild ref after a full branch clone', async () => {
		const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
		const runner: CommandRunner = {
			async exec(cmd, args, options) {
				calls.push({ cmd, args, cwd: options?.cwd });
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await gitClone(
			runner,
			'https://github.com/user/repo.git',
			'main',
			'/tmp/dest',
			undefined,
			'abc1234'
		);

		expect(result.success).toBe(true);
		expect(calls[0]).toEqual({
			cmd: 'git',
			args: ['clone', '--branch', 'main', 'https://github.com/user/repo.git', '/tmp/dest'],
			cwd: undefined
		});
		expect(calls[1]).toEqual({
			cmd: 'git',
			args: ['checkout', '--detach', 'abc1234'],
			cwd: '/tmp/dest'
		});
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

	it('builds with requested Docker network', async () => {
		const calls: string[][] = []
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args])
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const result = await dockerBuild(runner, {
			contextDir: '/tmp/ctx',
			imageTag: 'myapp:abc1234',
			network: 'risved'
		})

		expect(result.success).toBe(true)
		expect(calls[0]).toContain('--network')
		expect(calls[0]).toContain('risved')
	})

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

	it('passes volume mounts', async () => {
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
			volumes: ['risved-proj1-data:/app/data']
		});

		expect(calls[0]).toContain('-v');
		expect(calls[0]).toContain('risved-proj1-data:/app/data');
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

describe('projectVolumeName', () => {
	it('generates correct volume name from project ID', () => {
		expect(projectVolumeName('abc-123')).toBe('risved-abc-123-data');
	});
});

describe('dockerVolumeRemove', () => {
	it('removes volume with force flag', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await dockerVolumeRemove(runner, 'risved-proj1-data');
		expect(result.success).toBe(true);
		expect(calls[0]).toEqual(['docker', 'volume', 'rm', '-f', 'risved-proj1-data']);
	});

	it('succeeds if volume does not exist', async () => {
		const runner = mockRunner({
			'docker volume': { exitCode: 1, stdout: '', stderr: 'No such volume' }
		});

		const result = await dockerVolumeRemove(runner, 'nonexistent');
		expect(result.success).toBe(true);
	});

	it('returns error on unexpected failure', async () => {
		const runner = mockRunner({
			'docker volume': { exitCode: 1, stdout: '', stderr: 'permission denied' }
		});

		const result = await dockerVolumeRemove(runner, 'test-vol');
		expect(result.success).toBe(false);
		expect(result.error).toContain('permission denied');
	});
});

describe('ensureWarmImage', () => {
	it('skips build when the image already exists', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				if (args[0] === 'image' && args[1] === 'inspect') {
					return { exitCode: 0, stdout: 'sha256:abc\n', stderr: '' };
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await ensureWarmImage(runner);
		expect(result.success).toBe(true);
		expect(result.built).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('inspect');
	});

	it('builds the image when missing', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				if (args[0] === 'image' && args[1] === 'inspect') {
					return { exitCode: 1, stdout: '', stderr: 'No such image' };
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await ensureWarmImage(runner);
		expect(result.success).toBe(true);
		expect(result.built).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls[1].slice(0, 2)).toEqual(['docker', 'build']);
		expect(calls[1]).toContain('risved-node-build:22');
		expect(calls[1].some((arg) => arg.endsWith('node-build.Dockerfile'))).toBe(true);
	});

	it('returns the build error when the image build fails', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				if (args[0] === 'image' && args[1] === 'inspect') {
					return { exitCode: 1, stdout: '', stderr: 'No such image' };
				}
				if (args[0] === 'build') {
					return { exitCode: 1, stdout: '', stderr: 'apt-get failed' };
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const result = await ensureWarmImage(runner);
		expect(result.success).toBe(false);
		expect(result.error).toContain('apt-get failed');
	});
});

describe('freePort', () => {
	it('returns empty array when no containers are using the port', async () => {
		const runner = mockRunner({
			'docker ps': { exitCode: 0, stdout: '', stderr: '' }
		});
		const ids = await freePort(runner, 3001);
		expect(ids).toEqual([]);
	});

	it('returns empty array when docker ps fails', async () => {
		const runner = mockRunner({
			'docker ps': { exitCode: 1, stdout: '', stderr: 'error' }
		});
		const ids = await freePort(runner, 3001);
		expect(ids).toEqual([]);
	});

	it('removes containers found on the port and returns their IDs', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				if (args.includes('-q')) return { exitCode: 0, stdout: 'abc123\ndef456\n', stderr: '' };
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		const ids = await freePort(runner, 3001);
		expect(ids).toEqual(['abc123', 'def456']);
		const rmCalls = calls.filter((c) => c.includes('rm'));
		expect(rmCalls).toHaveLength(2);
	});
});

describe('toSshUrl', () => {
	it('converts github https url to ssh format', () => {
		expect(toSshUrl('https://github.com/user/repo.git')).toBe('git@github.com:user/repo.git');
	});

	it('converts gitlab https url to ssh format', () => {
		expect(toSshUrl('https://gitlab.com/org/project')).toBe('git@gitlab.com:org/project');
	});

	it('converts codeberg https url to ssh format', () => {
		expect(toSshUrl('https://codeberg.org/user/repo.git')).toBe('git@codeberg.org:user/repo.git');
	});

	it('returns url unchanged when not a recognised https host', () => {
		expect(toSshUrl('git@github.com:user/repo.git')).toBe('git@github.com:user/repo.git');
	});

	it('returns url unchanged for arbitrary urls', () => {
		const url = 'https://my-gitea.internal/user/repo.git';
		expect(toSshUrl(url)).toBe(url);
	});
});

describe('getContainerLogs', () => {
	it('returns combined stdout and stderr trimmed', async () => {
		const runner = mockRunner({
			'docker logs': { exitCode: 0, stdout: 'line1\nline2\n', stderr: 'warn\n' }
		});
		const logs = await getContainerLogs(runner, 'my-app');
		expect(logs).toContain('line1');
		expect(logs).toContain('warn');
	});

	it('accepts custom tail count', async () => {
		const calls: string[][] = [];
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args]);
				return { exitCode: 0, stdout: 'log output', stderr: '' };
			}
		};
		await getContainerLogs(runner, 'my-app', 50);
		expect(calls[0]).toContain('50');
	});
});

describe('dockerStop error paths', () => {
	it('returns error when stop fails with unexpected error', async () => {
		const runner = mockRunner({
			'docker stop': { exitCode: 1, stdout: '', stderr: 'permission denied' }
		});
		const result = await dockerStop(runner, 'my-app');
		expect(result.success).toBe(false);
		expect(result.error).toContain('permission denied');
	});

	it('returns error when rm fails with unexpected error', async () => {
		const runner = mockRunner({
			'docker stop': { exitCode: 0, stdout: '', stderr: '' },
			'docker rm': { exitCode: 1, stdout: '', stderr: 'volume in use' }
		});
		const result = await dockerStop(runner, 'my-app');
		expect(result.success).toBe(false);
		expect(result.error).toContain('volume in use');
	});
});
