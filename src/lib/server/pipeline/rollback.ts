import { db } from '$lib/server/db';
import { deployments } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '$lib/server/settings';
import { CaddyClient, createCaddyClient } from '../caddy';
import { dockerRun, dockerStop, waitForHealthy, freePort, projectVolumeName } from './docker';
import { createLogCollector } from './log';
import type { PipelinePhase, PipelineResult, LogEmitter, CommandRunner } from './types';

export interface RollbackConfig {
	projectId: string;
	projectSlug: string;
	/** The image tag from the previous successful deployment */
	imageTag: string;
	/** The commit SHA from the previous deployment */
	commitSha: string | null;
	port: number;
	domain?: string;
}

/**
 * Run a rollback deployment using an existing Docker image.
 *
 * Skips clone/detect/build phases — goes straight to start → health → route → cutover → live.
 */
export async function runRollback(
	config: RollbackConfig,
	runner: CommandRunner,
	options?: {
		onLog?: LogEmitter;
		caddy?: CaddyClient;
		fetchFn?: typeof fetch;
		healthTimeoutMs?: number;
		healthIntervalMs?: number;
	}
): Promise<PipelineResult> {
	const deploymentId = crypto.randomUUID();
	const { emit, entries } = createLogCollector(deploymentId, options?.onLog);
	const caddy = options?.caddy ?? createCaddyClient();

	/* Create deployment record with rollback trigger type */
	await db.insert(deployments).values({
		id: deploymentId,
		projectId: config.projectId,
		status: 'running',
		triggerType: 'rollback',
		imageTag: config.imageTag,
		commitSha: config.commitSha,
		startedAt: new Date().toISOString()
	});

	try {
		emit('start', `Rolling back to image ${config.imageTag}`);

		/* ── Start ──────────────────────────────── */
		const containerName = config.projectSlug;
		emit('start', `Starting container ${containerName} on port ${config.port}…`);

		/* Stop any container using the target port */
		const freed = await freePort(runner, config.port)
		if (freed.length > 0) {
			emit('start', `Removed ${freed.length} container(s) occupying port ${config.port}`)
		}
		await runner.exec('docker', ['rm', '-f', containerName]);

		const volumeName = projectVolumeName(config.projectId)
		emit('start', `Mounting persistent volume at /app/data`)

		const runResult = await dockerRun(runner, {
			imageTag: config.imageTag,
			containerName,
			port: config.port,
			volumes: [`${volumeName}:/app/data`]
		});
		if (!runResult.success) {
			throw new RollbackError('start', `Docker run failed: ${runResult.error}`);
		}
		emit('start', `Container started (ID: ${runResult.containerId})`);

		/* ── Health ─────────────────────────────── */
		emit('health', 'Waiting for health check…');
		const healthy = await waitForHealthy(
			containerName,
			options?.healthTimeoutMs ?? 30000,
			options?.healthIntervalMs ?? 2000,
			options?.fetchFn ?? globalThis.fetch
		);
		if (!healthy) {
			await dockerStop(runner, containerName, 5);
			throw new RollbackError('health', 'Health check timed out after 30s');
		}
		emit('health', 'Health check passed');

		/* ── Route ──────────────────────────────── */
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

		/* Also add alt route via control plane hostname */
		if (config.domain) {
			const hostname = await getSetting('hostname')
			if (hostname && !config.domain.endsWith(hostname)) {
				const altDomain = `${config.projectSlug}.${hostname}`
				const altResult = await caddy.addRoute({ hostname: altDomain, port: config.port })
				if (!altResult.success) {
					emit('route', `Warning: alt route failed (${altDomain}): ${altResult.error}`, 'warn')
				} else {
					emit('route', `Alt route configured: ${altDomain}`)
				}
			}
		}

		/* ── Live ───────────────────────────────── */
		emit('live', 'Rollback deployment is live');

		await db
			.update(deployments)
			.set({
				status: 'live',
				containerName,
				finishedAt: new Date().toISOString()
			})
			.where(eq(deployments.id, deploymentId));



		return {
			success: true,
			deploymentId,
			commitSha: config.commitSha ?? undefined,
			imageTag: config.imageTag,
			containerName,
			logs: entries
		};
	} catch (err) {
		const phase = err instanceof RollbackError ? err.phase : 'start';
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
	}
}

class RollbackError extends Error {
	constructor(
		public readonly phase: PipelinePhase,
		message: string
	) {
		super(message);
		this.name = 'RollbackError';
	}
}
