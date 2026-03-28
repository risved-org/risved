import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, rm, access } from 'node:fs/promises';
import { db } from '$lib/server/db';
import { deployments, projects, envVars } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '$lib/server/settings';
import { safeDecrypt } from '$lib/server/crypto';
import { detectFramework, createFsContext } from '../detection';
import { generateDockerfile } from '../dockerfile';
import { CaddyClient } from '../caddy';
import {
	gitClone,
	getCommitSha,
	dockerBuild,
	dockerRun,
	dockerStop,
	waitForHealthy,
	freePort
} from './docker';
import { createLogCollector } from './log';
import type {
	PipelineConfig,
	PipelineResult,
	LogEmitter,
	CommandRunner,
	PipelinePhase
} from './types';

export type { PipelineConfig, PipelineResult, LogEntry, LogEmitter, PipelinePhase } from './types';

/**
 * Run the full deployment pipeline for a project.
 *
 * Phases: clone → detect → build → start → health → route → cutover → live
 * Each phase emits log entries that can be streamed to the client.
 */
export async function runPipeline(
	config: PipelineConfig,
	runner: CommandRunner,
	options?: {
		onLog?: LogEmitter;
		caddy?: CaddyClient;
		fetchFn?: typeof fetch;
		healthTimeoutMs?: number;
		healthIntervalMs?: number;
		deploymentId?: string;
	}
): Promise<PipelineResult> {
	const deploymentId = options?.deploymentId ?? crypto.randomUUID();
	const { emit, entries } = createLogCollector(deploymentId, options?.onLog);
	const caddy = options?.caddy ?? new CaddyClient();

	/* Create deployment record (skip if pre-created by the API handler) */
	if (!options?.deploymentId) {
		await db.insert(deployments).values({
			id: deploymentId,
			projectId: config.projectId,
			status: 'running',
			startedAt: new Date().toISOString()
		})
	}

	const workDir = join(tmpdir(), `risved-build-${config.projectSlug}-${Date.now()}`);
	const cloneDir = join(workDir, 'repo');

	try {
		/* ── Phase 1: Clone ──────────────────────────────── */
		emit('clone', `Cloning ${config.repoUrl} (branch: ${config.branch})`);
		await mkdir(workDir, { recursive: true });

		/* Kick off clone, env var fetch, and SSH key lookup in parallel */
		const sshKeyPromise = getSetting('ssh_deploy_private_key')
		const envVarsPromise = db
			.select({ key: envVars.key, value: envVars.value })
			.from(envVars)
			.where(eq(envVars.projectId, config.projectId))

		const sshKey = await sshKeyPromise
		const cloneResult = await gitClone(runner, config.repoUrl, config.branch, cloneDir, sshKey ?? undefined);
		if (!cloneResult.success) {
			throw new PipelineError('clone', `Git clone failed: ${cloneResult.error}`);
		}

		const commitSha = await getCommitSha(runner, cloneDir);
		emit('clone', `Cloned at commit ${commitSha ?? 'unknown'}`);

		/* Resolve env vars (started in parallel with clone) */
		const projectEnvVars = await envVarsPromise
		const envMap: Record<string, string> = {}
		for (const row of projectEnvVars) {
			envMap[row.key] = safeDecrypt(row.value)
		}

		/* ── Phase 2: Detect ─────────────────────────────── */
		let frameworkId = config.frameworkId;
		let tier = config.tier;

		if (!frameworkId || !tier) {
			emit('detect', 'Detecting framework…');
			const ctx = createFsContext(cloneDir);
			const detection = await detectFramework(ctx);
			if (!detection.detected || !detection.framework) {
				throw new PipelineError('detect', 'Could not detect framework');
			}
			frameworkId = frameworkId ?? detection.framework.id;
			tier = tier ?? detection.framework.tier;
			emit(
				'detect',
				`Detected ${detection.framework.name} (${tier} tier, ${detection.framework.confidence} confidence)`
			);
		} else {
			emit('detect', `Using saved: ${frameworkId} (${tier} tier)`);
		}

		/* Update project with detected framework info */
		await db
			.update(projects)
			.set({ frameworkId, tier, updatedAt: new Date().toISOString() })
			.where(eq(projects.id, config.projectId));

		/* ── Phase 3: Build ──────────────────────────────── */
		emit('build', 'Generating Dockerfile…');

		/* Detect lockfile to pick the right package manager */
		const lockfiles = ['bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'] as const
		let lockfile: typeof lockfiles[number] | null = null
		for (const lf of lockfiles) {
			try {
				await access(join(cloneDir, lf))
				lockfile = lf
				break
			} catch { /* not found */ }
		}
		if (lockfile) emit('build', `Detected ${lockfile}`)

		const dockerfile = generateDockerfile({ frameworkId, tier, lockfile });
		let dockerfileContent = dockerfile.content

		/* Inject ENV lines into the Dockerfile so env vars are available as
		   process.env during build (needed by SvelteKit $env, Next.js, etc).
		   Inserted right before the build RUN command in the builder stage. */
		if (Object.keys(envMap).length > 0) {
			const envLines = Object.entries(envMap)
				.map(([k, v]) => `ENV ${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
				.join('\n')
			dockerfileContent = dockerfileContent.replace(
				'COPY . .',
				`COPY . .\n${envLines}`
			)
			emit('build', `Injecting ${projectEnvVars.length} env var(s) into build`)
		}

		await writeFile(join(cloneDir, 'Dockerfile'), dockerfileContent);
		await writeFile(join(cloneDir, '.dockerignore'), [
			'.git',
			'node_modules',
			'.svelte-kit',
			'.next',
			'.nuxt',
			'.output',
			'dist',
			'.env*',
			'Dockerfile',
			'.dockerignore'
		].join('\n'));
		emit('build', `Dockerfile generated for ${frameworkId} (${tier} tier)`);

		const imageTag = `${config.projectSlug}:${commitSha ?? 'latest'}`;
		emit('build', `Building image ${imageTag}…`);

		const buildResult = await dockerBuild(runner, {
			contextDir: cloneDir,
			imageTag,
			onLine: (line) => emit('build', line)
		});
		if (!buildResult.success) {
			throw new PipelineError('build', 'Docker build failed');
		}
		emit('build', 'Image built successfully');

		/* ── Phase 4: Start ──────────────────────────────── */
		const containerName = config.projectSlug;
		emit('start', `Starting container ${containerName} on port ${config.port}…`);
		if (projectEnvVars.length > 0) {
			emit('start', `Injecting ${projectEnvVars.length} env var(s)`)
		}

		/* Stop any container using the target port */
		const freed = await freePort(runner, config.port)
		if (freed.length > 0) {
			emit('start', `Removed ${freed.length} container(s) occupying port ${config.port}`)
		}

		/* Remove existing container with the same name */
		await runner.exec('docker', ['rm', '-f', containerName]);

		const runResult = await dockerRun(runner, {
			imageTag,
			containerName,
			port: config.port,
			env: envMap
		});
		if (!runResult.success) {
			throw new PipelineError('start', `Docker run failed: ${runResult.error}`);
		}
		emit('start', `Container started (ID: ${runResult.containerId})`);

		/* ── Phase 5: Health ─────────────────────────────── */
		emit('health', 'Waiting for health check…');
		const healthy = await waitForHealthy(
			config.port,
			options?.healthTimeoutMs ?? 30000,
			options?.healthIntervalMs ?? 2000,
			options?.fetchFn ?? globalThis.fetch
		);
		if (!healthy) {
			await dockerStop(runner, containerName, 5);
			throw new PipelineError('health', 'Health check timed out after 30s');
		}
		emit('health', 'Health check passed');

		/* ── Phase 6: Route ──────────────────────────────── */
		if (config.domain) {
			emit('route', `Configuring route: ${config.domain} → port ${config.port}`);
			const routeResult = await caddy.addRoute({
				hostname: config.domain,
				port: config.port
			});
			if (!routeResult.success) {
				emit('route', `Warning: route update failed: ${routeResult.error}`, 'warn');
			} else {
				emit('route', 'Route configured');
			}
		} else {
			emit('route', 'No domain configured, skipping route setup');
		}

		/* ── Phase 7: Live ──────────────────────────────── */
		emit('live', 'Deployment is live');

		await db
			.update(deployments)
			.set({
				status: 'live',
				commitSha,
				imageTag,
				containerName,
				finishedAt: new Date().toISOString()
			})
			.where(eq(deployments.id, deploymentId));


		return {
			success: true,
			deploymentId,
			commitSha: commitSha ?? undefined,
			imageTag,
			containerName,
			logs: entries
		};
	} catch (err) {
		const phase = err instanceof PipelineError ? err.phase : 'build';
		const message = err instanceof Error ? err.message : 'Unknown error';
		emit(phase, message, 'error');

		await db
			.update(deployments)
			.set({
				status: 'failed',
				finishedAt: new Date().toISOString()
			})
			.where(eq(deployments.id, deploymentId));


		return {
			success: false,
			deploymentId,
			error: message,
			logs: entries
		};
	} finally {
		/* Cleanup work directory */
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Error class that tracks which pipeline phase failed.
 */
class PipelineError extends Error {
	constructor(
		public readonly phase: PipelinePhase,
		message: string
	) {
		super(message);
		this.name = 'PipelineError';
	}
}
