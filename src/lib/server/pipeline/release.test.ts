import { describe, it, expect, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined)
}));

import { runRelease } from './release';
import type { CommandRunner } from './types';

function makeRunner(
	impl: (
		cmd: string,
		args: string[]
	) => Promise<{ exitCode: number; stdout: string; stderr: string }>
): CommandRunner {
	return { exec: impl as never };
}

describe('runRelease', () => {
	it('spawns docker run targeting the build stage with sh -c', async () => {
		const calls: string[][] = [];
		const runner = makeRunner(async (cmd, args) => {
			calls.push([cmd, ...args]);
			return { exitCode: 0, stdout: '', stderr: '' };
		});

		const result = await runRelease(runner, {
			imageTag: 'my-app:abc1234',
			command: 'bun run migrate',
			env: { DATABASE_URL: 'file:/app/data/app.db' }
		});

		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);

		const dockerCall = calls.find((c) => c[0] === 'docker' && c[1] === 'run')!;
		expect(dockerCall).toContain('--target');
		expect(dockerCall).toContain('build');
		expect(dockerCall).toContain('--rm');
		expect(dockerCall).toContain('--network');
		expect(dockerCall).toContain('risved');
		expect(dockerCall).toContain('--env-file');

		/* The last four args are the image tag and `sh -c "<command>"` so users can
		   write compound commands without us parsing shell syntax. */
		const imageIdx = dockerCall.indexOf('my-app:abc1234');
		expect(dockerCall[imageIdx + 1]).toBe('sh');
		expect(dockerCall[imageIdx + 2]).toBe('-c');
		expect(dockerCall[imageIdx + 3]).toBe('bun run migrate');
	});

	it('passes volume mounts through', async () => {
		let captured: string[] | null = null;
		const runner = makeRunner(async (cmd, args) => {
			if (args[0] === 'run') captured = args;
			return { exitCode: 0, stdout: '', stderr: '' };
		});

		await runRelease(runner, {
			imageTag: 'img',
			command: 'echo hi',
			env: {},
			volumes: ['risved-proj-1-data:/app/data', 'some-other:/mnt']
		});

		expect(captured).toContain('-v');
		expect(captured).toContain('risved-proj-1-data:/app/data');
		expect(captured).toContain('some-other:/mnt');
	});

	it('reports non-zero exit code from the release container', async () => {
		const runner = makeRunner(async (_cmd, args) => {
			if (args[0] === 'run') {
				return { exitCode: 2, stdout: '', stderr: 'migration failed' };
			}
			return { exitCode: 0, stdout: '', stderr: '' };
		});

		const result = await runRelease(runner, {
			imageTag: 'img',
			command: 'false',
			env: {}
		});

		expect(result.exitCode).toBe(2);
		expect(result.timedOut).toBe(false);
	});

	it('forces container removal when the timeout elapses', async () => {
		vi.useFakeTimers();
		const calls: string[][] = [];
		const runner = makeRunner(async (cmd, args) => {
			calls.push([cmd, ...args]);
			if (args[0] === 'run') {
				/* Simulate a long-running container that is killed externally. */
				return new Promise((resolve) => {
					/* Never resolve on its own; resolve only after the timer fires. */
					const interval = setInterval(() => {
						const didKill = calls.some(
							(c) => c[0] === 'docker' && c[1] === 'rm' && c.includes('-f')
						);
						if (didKill) {
							clearInterval(interval);
							resolve({ exitCode: 137, stdout: '', stderr: 'killed' });
						}
					}, 10);
				});
			}
			return { exitCode: 0, stdout: '', stderr: '' };
		});

		const promise = runRelease(runner, {
			imageTag: 'img',
			command: 'sleep 9999',
			env: {},
			timeoutMs: 100,
			containerName: 'release-test'
		});

		/* Advance past the timeout so the kill fires. */
		await vi.advanceTimersByTimeAsync(200);
		vi.useRealTimers();

		const result = await promise;
		expect(result.timedOut).toBe(true);
		/* Container should have been force-removed by name. */
		const rmCall = calls.find(
			(c) => c[0] === 'docker' && c[1] === 'rm' && c.includes('release-test')
		);
		expect(rmCall).toBeTruthy();
	});

	it('streams stdout lines via onLine', async () => {
		const lines: string[] = [];
		const runner: CommandRunner = {
			async exec(_cmd, args, options) {
				if (args[0] === 'run' && options?.onLine) {
					options.onLine('Running migrations...');
					options.onLine('Migration 0001 applied');
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		};

		await runRelease(runner, {
			imageTag: 'img',
			command: 'bun run migrate',
			env: {},
			onLine: (line) => lines.push(line)
		});

		expect(lines).toEqual(['Running migrations...', 'Migration 0001 applied']);
	});
});
