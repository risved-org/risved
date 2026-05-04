import { writeFile, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CommandRunner, DockerBuildOptions, DockerRunOptions } from './types';

const DOCKER_NETWORK = 'risved';

const NODE_BUILD_IMAGE = 'risved-node-build:22';

/**
 * Path to the bundled builder Dockerfiles inside the control-plane container.
 * Override with RISVED_BUILDERS_DIR for development/testing.
 */
function buildersDir(): string {
	return process.env.RISVED_BUILDERS_DIR ?? '/app/scripts/builders';
}

/**
 * Verify the warm Node builder image is present in the host's image store, and
 * build it on demand if it is not. The host install script populates this image
 * out-of-band, but it can be missing on first deploy after a fresh install
 * (background job didn't finish, network blip skipped script download) or
 * after Docker prunes unused images. Building here makes the pipeline
 * self-healing instead of failing with an opaque "pull access denied" from
 * Docker Hub.
 */
export async function ensureWarmImage(
	runner: CommandRunner,
	options: { onLine?: (line: string) => void } = {}
): Promise<{ success: boolean; built: boolean; error?: string }> {
	const inspect = await runner.exec(
		'docker',
		['image', 'inspect', '--format', '{{.Id}}', NODE_BUILD_IMAGE]
	)
	if (inspect.exitCode === 0) return { success: true, built: false }

	const dir = buildersDir()
	options.onLine?.(`Warm builder image ${NODE_BUILD_IMAGE} not found, building it now…`)
	const result = await runner.exec(
		'docker',
		[
			'build',
			'--progress=plain',
			'-t',
			NODE_BUILD_IMAGE,
			'-f',
			`${dir}/node-build.Dockerfile`,
			dir
		],
		{ onLine: options.onLine }
	)
	if (result.exitCode !== 0) {
		return {
			success: false,
			built: false,
			error: result.stderr || result.stdout || 'docker build failed'
		}
	}
	return { success: true, built: true }
}

/**
 * Build a Docker image from a context directory.
 * Uses --network to allow package downloads during build.
 */
export async function dockerBuild(
	runner: CommandRunner,
	options: DockerBuildOptions
): Promise<{ success: boolean; error?: string }> {
	const { contextDir, imageTag, target, buildArgs, onLine } = options;

	const args = ['build', '--progress=plain', '-t', imageTag]
	if (target) {
		args.push('--target', target)
	}
	if (buildArgs) {
		for (const [key, val] of Object.entries(buildArgs)) {
			args.push('--build-arg', `${key}=${val}`)
		}
	}
	args.push(contextDir)

	const result = await runner.exec('docker', args, { onLine });

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
	const { imageTag, containerName, port, network = DOCKER_NETWORK, env = {}, volumes = [] } = options;
	const args = ['run', '-d', '--network', network, '--name', containerName, '-p', `${port}:3000`];

	/* Ensure the app binds to all interfaces so the health check and
	   reverse proxy can reach it over the Docker network. */
	args.push('-e', 'HOST=0.0.0.0');
	args.push('-e', 'HOSTNAME=0.0.0.0');

	for (const [key, val] of Object.entries(env)) {
		args.push('-e', `${key}=${val}`);
	}

	for (const vol of volumes) {
		args.push('-v', vol);
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
 * Find and force-remove any Docker container bound to the given host port.
 * Waits briefly after removal to let Docker release the port binding.
 */
export async function freePort(runner: CommandRunner, port: number): Promise<string[]> {
	const result = await runner.exec('docker', [
		'ps', '-q', '--filter', `publish=${port}`
	])
	if (result.exitCode !== 0 || !result.stdout.trim()) return []

	const ids = result.stdout.trim().split('\n').filter(Boolean)
	for (const id of ids) {
		await runner.exec('docker', ['rm', '-f', id])
	}

	/* Brief pause to let Docker release the port binding */
	await new Promise((resolve) => setTimeout(resolve, 300))
	return ids
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
 * Convert an HTTPS repo URL to SSH format when an SSH key is available.
 * e.g. https://github.com/user/repo.git → git@github.com:user/repo.git
 */
export function toSshUrl(httpsUrl: string): string {
	const m = httpsUrl.match(/^https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/(.+)$/)
	if (m) return `git@${m[1]}:${m[2]}`
	return httpsUrl
}

/**
 * Clone a repository with shallow depth.
 * When sshPrivateKeyB64 is provided, writes a temp key file and
 * sets GIT_SSH_COMMAND so git authenticates via SSH.
 */
export async function gitClone(
	runner: CommandRunner,
	repoUrl: string,
	branch: string,
	destDir: string,
	sshPrivateKeyB64?: string
): Promise<{ success: boolean; error?: string }> {
	let keyFile: string | undefined
	let cloneUrl = repoUrl

	if (sshPrivateKeyB64) {
		/* Decode full OpenSSH private key from base64 and write to temp file */
		keyFile = join(tmpdir(), `risved-ssh-${Date.now()}`)
		const keyContent = atob(sshPrivateKeyB64)
		await writeFile(keyFile, keyContent, { mode: 0o600 })
		await chmod(keyFile, 0o600)

		cloneUrl = toSshUrl(repoUrl)
	}

	try {
		const env = keyFile
			? { GIT_SSH_COMMAND: `ssh -i ${keyFile} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes` }
			: undefined

		const result = await runner.exec(
			'git',
			['clone', '--depth', '1', '--single-branch', '--branch', branch, cloneUrl, destDir],
			{ env }
		)

		if (result.exitCode !== 0) {
			return { success: false, error: result.stderr || result.stdout }
		}
		return { success: true }
	} finally {
		if (keyFile) {
			await rm(keyFile, { force: true }).catch(() => {})
		}
	}
}

/**
 * Check if a Docker container is running and responds to health checks.
 * Polls the container's HTTP endpoint every intervalMs until timeoutMs.
 */
export async function waitForHealthy(
	containerNameOrPort: string | number,
	timeoutMs = 60000,
	intervalMs = 2000,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	/* When a container name is provided, health-check over the Docker network
	   on port 3000 (the internal port all apps listen on). Falls back to
	   localhost:{port} for backwards compatibility. */
	const url =
		typeof containerNameOrPort === 'string'
			? `http://${containerNameOrPort}:3000/`
			: `http://localhost:${containerNameOrPort}/`

	while (Date.now() < deadline) {
		try {
			const res = await fetchFn(url, {
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
 * Generate the named volume name for a project's persistent data.
 */
export function projectVolumeName(projectId: string): string {
	return `risved-${projectId}-data`
}

/**
 * Remove a named Docker volume. Succeeds silently if the volume does not exist.
 */
export async function dockerVolumeRemove(
	runner: CommandRunner,
	volumeName: string
): Promise<{ success: boolean; error?: string }> {
	const result = await runner.exec('docker', ['volume', 'rm', '-f', volumeName])
	if (result.exitCode !== 0 && !result.stderr.includes('No such volume')) {
		return { success: false, error: result.stderr }
	}
	return { success: true }
}

/**
 * Fetch the last N lines of logs from a Docker container.
 * Useful for diagnosing why a container failed to become healthy.
 */
export async function getContainerLogs(
	runner: CommandRunner,
	containerName: string,
	tail = 30
): Promise<string> {
	const result = await runner.exec('docker', ['logs', '--tail', String(tail), containerName])
	return (result.stdout + result.stderr).trim()
}

/**
 * Create a CommandRunner that executes real shell commands.
 * Uses Node's child_process.execFile for safety.
 */
export function createCommandRunner(): CommandRunner {
	return {
		async exec(cmd, args, options) {
			/* Use spawn for streaming output when onLine is provided */
			if (options?.onLine) {
				const { spawn } = await import('node:child_process')
				return new Promise((resolve) => {
					const child = spawn(cmd, args, {
						cwd: options?.cwd,
						env: options?.env ? { ...process.env, ...options.env } : undefined
					})
					let stdout = ''
					let stderr = ''

					const handleData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
						const text = data.toString()
						if (stream === 'stdout') stdout += text
						else stderr += text
						for (const line of text.split('\n')) {
							const trimmed = line.trim()
							if (trimmed) options.onLine!(trimmed)
						}
					}

					child.stdout?.on('data', handleData('stdout'))
					child.stderr?.on('data', handleData('stderr'))
					child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }))
					child.on('error', (err) => resolve({ exitCode: 1, stdout: '', stderr: err.message }))
				})
			}

			const { execFile } = await import('node:child_process');
			const { promisify } = await import('node:util');
			const execFileAsync = promisify(execFile);

			try {
				const { stdout, stderr } = await execFileAsync(cmd, args, {
					cwd: options?.cwd,
					env: options?.env ? { ...process.env, ...options.env } : undefined,
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
