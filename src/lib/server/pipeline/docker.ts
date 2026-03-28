import { writeFile, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
	const { contextDir, imageTag, buildArgs, onLine } = options;

	const args = ['build', '--progress=plain', '-t', imageTag]
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
	await new Promise((resolve) => setTimeout(resolve, 1000))
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
		/* Write PKCS8 private key to temp file in PEM format */
		keyFile = join(tmpdir(), `risved-ssh-${Date.now()}`)
		const pemContent = [
			'-----BEGIN PRIVATE KEY-----',
			...sshPrivateKeyB64.match(/.{1,64}/g)!,
			'-----END PRIVATE KEY-----',
			''
		].join('\n')
		await writeFile(keyFile, pemContent, { mode: 0o600 })
		await chmod(keyFile, 0o600)

		cloneUrl = toSshUrl(repoUrl)
	}

	try {
		const env = keyFile
			? { GIT_SSH_COMMAND: `ssh -i ${keyFile} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes` }
			: undefined

		const result = await runner.exec(
			'git',
			['clone', '--depth', '1', '--branch', branch, cloneUrl, destDir],
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
