import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { db } from '$lib/server/db';
import { deployments, projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '$lib/server/settings';
import { detectFramework, createFsContext } from '../detection';
import { generateDockerfile } from '../dockerfile';
import { CaddyClient } from '../caddy';
import {
	gitClone,
	getCommitSha,
	dockerBuild,
	dockerRun,
	dockerStop,
	waitForHealthy
} from './docker';
import { createLogCollector, persistLogs } from './log';
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

		const sshKey = await getSetting('ssh_deploy_private_key')
		const cloneResult = await gitClone(runner, config.repoUrl, config.branch, cloneDir, sshKey ?? undefined);
		if (!cloneResult.success) {
			throw new PipelineError('clone', `Git clone failed: ${cloneResult.error}`);
		}

		const commitSha = await getCommitSha(runner, cloneDir);
		emit('clone', `Cloned at commit ${commitSha ?? 'unknown'}`);

		/* ── Phase 2: Detect ─────────────────────────────── */
		emit('detect', 'Detecting framework…');
		let frameworkId = config.frameworkId;
		let tier = config.tier;

		if (!frameworkId || !tier) {
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
			emit('detect', `Using override: ${frameworkId} (${tier} tier)`);
		}

		/* Update project with detected framework info */
		await db
			.update(projects)
			.set({ frameworkId, tier, updatedAt: new Date().toISOString() })
			.where(eq(projects.id, config.projectId));

		/* ── Phase 3: Build ──────────────────────────────── */
		emit('build', 'Generating Dockerfile…');
		const dockerfile = generateDockerfile({ frameworkId, tier });
		await writeFile(join(cloneDir, 'Dockerfile'), dockerfile.content);
		emit('build', `Dockerfile generated for ${frameworkId} (${tier} tier)`);

		const imageTag = `${config.projectSlug}:${commitSha ?? 'latest'}`;
		emit('build', `Building image ${imageTag}…`);

		const buildResult = await dockerBuild(runner, { contextDir: cloneDir, imageTag });
		if (!buildResult.success) {
			throw new PipelineError('build', `Docker build failed: ${buildResult.error}`);
		}
		emit('build', 'Image built successfully');

		/* ── Phase 4: Start ──────────────────────────────── */
		const containerName = config.projectSlug;
		emit('start', `Starting container ${containerName} on port ${config.port}…`);

		/* Check for existing container with same name (will be swapped in cutover) */
		const oldContainerName = `${containerName}-old-${Date.now()}`;
		const renameResult = await runner.exec('docker', ['rename', containerName, oldContainerName]);
		const hadOldContainer = renameResult.exitCode === 0;

		const runResult = await dockerRun(runner, {
			imageTag,
			containerName,
			port: config.port
		});
		if (!runResult.success) {
			/* Restore old container name if rename succeeded */
			if (hadOldContainer) {
				await runner.exec('docker', ['rename', oldContainerName, containerName]);
			}
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
			/* Roll back: stop new container, restore old */
			await dockerStop(runner, containerName, 5);
			if (hadOldContainer) {
				await runner.exec('docker', ['rename', oldContainerName, containerName]);
			}
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

		/* ── Phase 7: Cutover ────────────────────────────── */
		if (hadOldContainer) {
			emit('cutover', `Stopping old container (${oldContainerName}) with 10s grace period…`);
			await dockerStop(runner, oldContainerName, 10);
			emit('cutover', 'Old container stopped');
		} else {
			emit('cutover', 'No previous container to remove');
		}

		/* ── Phase 8: Live ───────────────────────────────── */
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

		await persistLogs(deploymentId, entries);

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

		await persistLogs(deploymentId, entries);

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
