import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { db } from '$lib/server/db';
import { deployments, projects, domains, envVars } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '$lib/server/settings';
import { safeDecrypt } from '$lib/server/crypto';
import { detectFramework, createFsContext } from '../detection';
import { generateDockerfile } from '../dockerfile';
import { detectPackageManager } from '../detect-package-manager';
import { CaddyClient, createCaddyClient } from '../caddy';
import {
	gitClone,
	getCommitSha,
	dockerBuild,
	dockerRun,
	dockerStop,
	waitForHealthy,
	freePort,
	getContainerLogs,
	projectVolumeName
} from './docker';
import { runRelease } from './release';
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
	const caddy = options?.caddy ?? createCaddyClient();

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

	let commitSha: string | null = null

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

		commitSha = await getCommitSha(runner, cloneDir);
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
		/* Detect package manager fresh from the checked-out repo — never
		   cached from onboarding, because the user may have changed
		   lockfiles since then. Warnings surface in the build log so the
		   user can see them in the deploy UI. */
		const pmResult = await detectPackageManager(cloneDir);
		const pmLabel = pmResult.packageManager + (pmResult.yarnVersion ? ` (${pmResult.yarnVersion})` : '');
		const pmSource = pmResult.lockfile ? `from ${pmResult.lockfile}` : 'no lockfile — using default';
		emit('build', `Detected package manager: ${pmLabel} (${pmSource})`);
		for (const warning of pmResult.warnings) {
			emit('build', warning, 'warn');
		}

		emit('build', 'Generating Dockerfile…');
		const dockerfile = generateDockerfile({
			frameworkId,
			tier,
			lockfile: pmResult.lockfile,
			yarnVersion: pmResult.yarnVersion,
			buildCommand: config.buildCommand || undefined,
			startCommand: config.startCommand || undefined
		});
		const dockerfileContent = dockerfile.content

		/* Write all env vars into a build-time .env file so that:
		   - PUBLIC_* vars get inlined into client bundles by Vite/Next.js
		   - Private vars (BETTER_AUTH_SECRET, DATABASE_URL, etc.) are
		     available when SvelteKit analyzes server modules during build
		   The .env file lives only in the builder stage — it is NOT copied
		   to the runtime image (only copyPaths are). Secrets stay safe.
		   At runtime, all env vars are passed via `docker run -e`. */
		const buildEnv = Object.entries(envMap)
		if (buildEnv.length > 0) {
			const dotenv = buildEnv
				.map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
				.join('\n')
			await writeFile(join(cloneDir, '.env'), dotenv)
			emit('build', `Injecting ${buildEnv.length} env var(s) into build`)
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

		/* ── Phase 3b: Release ───────────────────────────── */
		const releaseCommand = config.releaseCommand?.trim() || null;
		const volumeName = projectVolumeName(config.projectId);
		const volumes = [`${volumeName}:/app/data`];

		if (releaseCommand) {
			/* Build a throwaway image from the build stage so the release
			   command has access to dev dependencies (e.g. drizzle-kit).
			   All layers are cached from the main build, so this is near-instant. */
			const releaseImageTag = `${imageTag}-release`
			const releaseBuild = await dockerBuild(runner, {
				contextDir: cloneDir,
				imageTag: releaseImageTag,
				target: 'build',
				onLine: (line) => emit('release', line)
			})
			if (!releaseBuild.success) {
				throw new PipelineError('release', 'Failed to build release image')
			}

			emit('release', `Running release command: ${releaseCommand}`);

			const releaseResult = await runRelease(runner, {
				imageTag: releaseImageTag,
				command: releaseCommand,
				env: envMap,
				volumes,
				containerName: `risved-release-${deploymentId.slice(0, 8)}`,
				onLine: (line) => emit('release', line)
			});

			await db
				.update(deployments)
				.set({
					releaseCommand,
					releaseExitCode: releaseResult.exitCode
				})
				.where(eq(deployments.id, deploymentId));

			if (releaseResult.timedOut) {
				throw new PipelineError(
					'release',
					`Release command timed out (exit code ${releaseResult.exitCode})`
				);
			}
			if (releaseResult.exitCode !== 0) {
				throw new PipelineError(
					'release',
					`Release command failed (exit code ${releaseResult.exitCode})`
				);
			}
			emit('release', 'Release command completed');

			/* Remove the throwaway release image */
			await runner.exec('docker', ['rmi', releaseImageTag]).catch(() => {})
		}

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

		emit('start', `Mounting persistent volume at /app/data`)

		const runResult = await dockerRun(runner, {
			imageTag,
			containerName,
			port: config.port,
			env: envMap,
			volumes
		});
		if (!runResult.success) {
			throw new PipelineError('start', `Docker run failed: ${runResult.error}`);
		}
		emit('start', `Container started (ID: ${runResult.containerId})`);

		/* ── Phase 5: Health ─────────────────────────────── */
		emit('health', 'Waiting for health check…');
		const healthTimeout = options?.healthTimeoutMs ?? 60000
		const healthy = await waitForHealthy(
			config.port,
			healthTimeout,
			options?.healthIntervalMs ?? 2000,
			options?.fetchFn ?? globalThis.fetch
		);
		if (!healthy) {
			const logs = await getContainerLogs(runner, containerName)
			if (logs) {
				for (const line of logs.split('\n')) {
					emit('health', line, 'error')
				}
			}
			await dockerStop(runner, containerName, 5);
			throw new PipelineError('health', `Health check timed out after ${healthTimeout / 1000}s`);
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

		/* Also configure routes for custom domains */
		const customDomains = await db
			.select({ hostname: domains.hostname })
			.from(domains)
			.where(eq(domains.projectId, config.projectId))

		for (const d of customDomains) {
			const r = await caddy.addRoute({ hostname: d.hostname, port: config.port })
			if (!r.success) {
				emit('route', `Warning: custom domain route failed (${d.hostname}): ${r.error}`, 'warn')
			} else {
				emit('route', `Custom domain route configured: ${d.hostname}`)
			}
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
				commitSha,
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
