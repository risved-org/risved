import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner } from './types';

/** Default release command timeout: 10 minutes. */
export const DEFAULT_RELEASE_TIMEOUT_MS = 10 * 60 * 1000;

/** Risved's shared Docker network. */
const DOCKER_NETWORK = 'risved';

/**
 * Shape of a function that streams one line of output from the release container.
 */
export type ReleaseLineEmitter = (line: string, stream: 'stdout' | 'stderr') => void;

export interface RunReleaseOptions {
	/** Fully qualified image tag produced by the build phase. */
	imageTag: string;
	/** Shell command to execute inside the build-stage container. */
	command: string;
	/** Project's production environment variables. */
	env: Record<string, string>;
	/** Volume mounts in Docker --volume format (`name:/path`). */
	volumes?: string[];
	/** Docker network name. Defaults to the risved network. */
	network?: string;
	/** Timeout in milliseconds. Defaults to 10 minutes. */
	timeoutMs?: number;
	/** Called for each line of stdout/stderr. */
	onLine?: ReleaseLineEmitter;
	/** Name to use for the ephemeral container (helpful for diagnostics). */
	containerName?: string;
}

export interface RunReleaseResult {
	exitCode: number;
	/** True when the container was killed because the timeout elapsed. */
	timedOut: boolean;
	stdout: string;
	stderr: string;
}

/**
 * Run the release command in a one-off container spawned from the `build`
 * stage of the project's image.
 *
 * This function is intentionally small and platform-agnostic: it does not
 * know anything about ORMs, migration shapes, or frameworks. It runs the
 * configured shell command and reports the exit code.
 *
 * On timeout, the container is force-killed and `timedOut: true` is returned.
 * Logs are streamed via onLine as they arrive so the UI can surface them
 * in real time.
 */
export async function runRelease(
	runner: CommandRunner,
	options: RunReleaseOptions
): Promise<RunReleaseResult> {
	const {
		imageTag,
		command,
		env,
		volumes = [],
		network = DOCKER_NETWORK,
		timeoutMs = DEFAULT_RELEASE_TIMEOUT_MS,
		onLine,
		containerName = `release-${Date.now()}`
	} = options;

	/* Write env vars to a temp env-file instead of passing dozens of -e flags.
	   The file is removed after the container exits. */
	const envFile = join(tmpdir(), `risved-release-env-${Date.now()}`);
	await writeEnvFile(envFile, env);

	const args = [
		'run',
		'--rm',
		'--name',
		containerName,
		'--network',
		network,
		'--env-file',
		envFile
	];

	for (const vol of volumes) {
		args.push('-v', vol);
	}

	args.push(imageTag, 'sh', '-c', command);

	/* Enforce the timeout by racing the exec against a timer that
	   force-removes the container. The exec resolves with whatever
	   exit code Docker reports; timedOut flips when we had to kill it. */
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		runner.exec('docker', ['rm', '-f', containerName]).catch(() => {});
	}, timeoutMs);

	try {
		const result = await runner.exec('docker', args, {
			onLine: onLine ? (line) => onLine(line, 'stdout') : undefined
		});

		return {
			exitCode: result.exitCode,
			timedOut,
			stdout: result.stdout,
			stderr: result.stderr
		};
	} finally {
		clearTimeout(timer);
		await rm(envFile, { force: true }).catch(() => {});
	}
}

/**
 * Write env vars to a Docker --env-file.
 *
 * Docker expects `KEY=value` per line with no shell-style quoting; values
 * can contain literal `"` and `\` unescaped. Newlines inside values are
 * not supported by --env-file, so we replace them with spaces and emit
 * a warning via the return value is out of scope — we simply rewrite
 * to keep the file valid.
 */
async function writeEnvFile(path: string, env: Record<string, string>): Promise<void> {
	const lines = Object.entries(env).map(([k, v]) => {
		/* Docker's --env-file format does not support embedded newlines. */
		const safe = v.replace(/\r?\n/g, ' ');
		return `${k}=${safe}`;
	});
	await writeFile(path, lines.join('\n'));
}
