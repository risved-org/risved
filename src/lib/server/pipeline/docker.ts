import type { CommandRunner, DockerBuildOptions, DockerRunOptions } from './types';

const DOCKER_NETWORK = 'risved';

/**
 * Build a Docker image from a context directory.
 * Uses --network to allow package downloads during build.
 */
export async function dockerBuild(
	runner: CommandRunner,
	options: DockerBuildOptions
): Promise<{ success: boolean; error?: string }> {
	const { contextDir, imageTag, network = DOCKER_NETWORK } = options;
	const result = await runner.exec('docker', [
		'build',
		'--network',
		network,
		'-t',
		imageTag,
		contextDir
	]);

	if (result.exitCode !== 0) {
		return { success: false, error: result.stderr || result.stdout };
	}
	return { success: true };
}

/**
 * Run a Docker container in detached mode on the risved network.
 */
export async function dockerRun(
	runner: CommandRunner,
	options: DockerRunOptions
): Promise<{ success: boolean; containerId?: string; error?: string }> {
	const { imageTag, containerName, port, network = DOCKER_NETWORK, env = {} } = options;
	const args = ['run', '-d', '--network', network, '--name', containerName, '-p', `${port}:3000`];

	for (const [key, val] of Object.entries(env)) {
		args.push('-e', `${key}=${val}`);
	}

	args.push(imageTag);

	const result = await runner.exec('docker', args);

	if (result.exitCode !== 0) {
		return { success: false, error: result.stderr || result.stdout };
	}
	return { success: true, containerId: result.stdout.trim().slice(0, 12) };
}

/**
 * Stop and remove a Docker container by name.
 * Waits for the grace period before force-killing.
 */
export async function dockerStop(
	runner: CommandRunner,
	containerName: string,
	gracePeriod = 10
): Promise<{ success: boolean; error?: string }> {
	const stopResult = await runner.exec('docker', [
		'stop',
		'-t',
		String(gracePeriod),
		containerName
	]);

	if (stopResult.exitCode !== 0 && !stopResult.stderr.includes('No such container')) {
		return { success: false, error: stopResult.stderr };
	}

	const rmResult = await runner.exec('docker', ['rm', '-f', containerName]);
	if (rmResult.exitCode !== 0 && !rmResult.stderr.includes('No such container')) {
		return { success: false, error: rmResult.stderr };
	}

	return { success: true };
}

/**
 * Get the short commit SHA from a cloned repository.
 */
export async function getCommitSha(runner: CommandRunner, repoDir: string): Promise<string | null> {
	const result = await runner.exec('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: repoDir });
	if (result.exitCode !== 0) return null;
	return result.stdout.trim();
}

/**
 * Clone a repository with shallow depth.
 */
export async function gitClone(
	runner: CommandRunner,
	repoUrl: string,
	branch: string,
	destDir: string
): Promise<{ success: boolean; error?: string }> {
	const result = await runner.exec('git', [
		'clone',
		'--depth',
		'1',
		'--branch',
		branch,
		repoUrl,
		destDir
	]);

	if (result.exitCode !== 0) {
		return { success: false, error: result.stderr || result.stdout };
	}
	return { success: true };
}

/**
 * Check if a Docker container is running and responds to health checks.
 * Polls the container's HTTP endpoint every intervalMs until timeoutMs.
 */
export async function waitForHealthy(
	port: number,
	timeoutMs = 30000,
	intervalMs = 2000,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			const res = await fetchFn(`http://localhost:${port}/`, {
				signal: AbortSignal.timeout(2000)
			});
			if (res.ok || res.status < 500) {
				return true;
			}
		} catch {
			/* container not ready yet */
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return false;
}

/**
 * Create a CommandRunner that executes real shell commands.
 * Uses Node's child_process.execFile for safety.
 */
export function createCommandRunner(): CommandRunner {
	return {
		async exec(cmd, args, options) {
			const { execFile } = await import('node:child_process');
			const { promisify } = await import('node:util');
			const execFileAsync = promisify(execFile);

			try {
				const { stdout, stderr } = await execFileAsync(cmd, args, {
					cwd: options?.cwd,
					maxBuffer: 10 * 1024 * 1024
				});
				return { exitCode: 0, stdout, stderr };
			} catch (err: unknown) {
				const e = err as { code?: number; stdout?: string; stderr?: string };
				return {
					exitCode: e.code ?? 1,
					stdout: e.stdout ?? '',
					stderr: e.stderr ?? ''
				};
			}
		}
	};
}
