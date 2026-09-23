import { db } from '$lib/server/db';
import { deployments, buildLogs, cronRuns, projects } from '$lib/server/db/schema';
import { inArray, isNotNull, lt } from 'drizzle-orm';
import { getSetting } from '$lib/server/settings';
import { createCommandRunner, projectVolumeName } from '$lib/server/pipeline/docker';
import { managedPostgresVolumeName } from '$lib/server/pipeline/postgres';
import type { CommandRunner } from '$lib/server/pipeline/types';
import {
	getDiskSpace,
	isDiskLow,
	pruneDockerResources,
	KEEP_IMAGES_PER_PROJECT,
	type DiskSpace,
	type DockerPruneSummary
} from './docker-prune';
import type { CleanupConfig, CleanupResult, DockerDiskUsage, DockerPruneResult } from './types';

export {
	getDiskSpace,
	isDiskLow,
	pruneDockerResources,
	pruneProjectImages,
	removeProjectImages,
	KEEP_IMAGES_PER_PROJECT,
	PROJECT_IMAGE_LABEL
} from './docker-prune';
export type { DiskSpace, DockerPruneSummary } from './docker-prune';

const RETAINED_DEPLOYMENT_LOGS_PER_PROJECT = 16;

type ExecFileFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const DEFAULT_CONFIG: CleanupConfig = {
	retentionDays: 30,
	intervalMs: 24 * 60 * 60 * 1000,
	diskCheckIntervalMs: 15 * 60 * 1000
};

/**
 * CleanupManager handles periodic build log retention, routine Docker
 * pruning, a host disk pressure watchdog, and manual prune operations.
 */
export class CleanupManager {
	private config: CleanupConfig;
	private runner: CommandRunner;
	private timer: ReturnType<typeof setInterval> | null = null;
	private diskTimer: ReturnType<typeof setInterval> | null = null;
	private startupTimer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private pruning = false;

	constructor(config: Partial<CleanupConfig> = {}, runner?: CommandRunner) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.runner = runner ?? createCommandRunner();
	}

	/** Start periodic cleanup runs. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.runCleanup();
			this.pruneDocker();
		}, this.config.intervalMs);
		this.diskTimer = setInterval(() => this.checkDiskPressure(), this.config.diskCheckIntervalMs);
		/* Run once on start after a short delay, including a routine Docker
		   prune so an update or restart reclaims space without waiting a day. */
		this.startupTimer = setTimeout(async () => {
			this.startupTimer = null;
			this.runCleanup();
			await this.pruneDocker();
			this.checkDiskPressure();
		}, 5000);
	}

	/** Stop periodic cleanup. */
	stop(): void {
		if (this.startupTimer) {
			clearTimeout(this.startupTimer);
			this.startupTimer = null;
		}
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.diskTimer) {
			clearInterval(this.diskTimer);
			this.diskTimer = null;
		}
	}

	/**
	 * Routine Docker housekeeping: drop images of old deployments (keeping the
	 * newest few per project for rollback), dangling layers and excess build
	 * cache. Aggressive mode keeps only the newest successful image per project
	 * and drops the whole build cache — used when the host disk is nearly full.
	 */
	async pruneDocker(aggressive = false): Promise<DockerPruneSummary | null> {
		if (this.pruning) return null;
		this.pruning = true;
		try {
			const summary = await pruneDockerResources(this.runner, {
				aggressive,
				keepPerProject: aggressive ? 1 : KEEP_IMAGES_PER_PROJECT
			});
			if (summary.imagesRemoved.length > 0 || summary.buildCacheReclaimed !== '0B') {
				console.log(
					`[cleanup] Docker prune removed ${summary.imagesRemoved.length} image(s), reclaimed ${summary.danglingReclaimed} dangling and ${summary.buildCacheReclaimed} build cache`
				);
			}
			return summary;
		} catch (err) {
			console.error('[cleanup] Docker prune failed:', err);
			return null;
		} finally {
			this.pruning = false;
		}
	}

	/** Read host disk space; null when the probe path is unavailable. */
	getDiskSpace(): Promise<DiskSpace | null> {
		return getDiskSpace(this.runner);
	}

	/**
	 * Watchdog: when the host disk is nearly full, prune aggressively so
	 * running apps and databases never hit a 100% full disk.
	 */
	async checkDiskPressure(): Promise<{ space: DiskSpace | null; pruned: DockerPruneSummary | null }> {
		const space = await this.getDiskSpace();
		if (!space || !isDiskLow(space)) return { space, pruned: null };

		console.warn(
			`[cleanup] Low disk space: ${formatBytes(space.freeBytes)} free (${space.freePercent.toFixed(0)}%) — pruning Docker resources`
		);
		const pruned = await this.pruneDocker(true);
		return { space, pruned };
	}

	isRunning(): boolean {
		return this.timer !== null;
	}

	/**
	 * Delete old build logs based on the configured retention period
	 * while keeping deployment records as durable history.
	 */
	async runCleanup(): Promise<CleanupResult> {
		if (this.running) {
			return { deploymentsRemoved: 0, buildLogsRemoved: 0, cutoffDate: '' };
		}
		this.running = true;

		try {
			const retentionSetting = await getSetting('log_retention_days');
			const retentionDays = retentionSetting
				? parseInt(retentionSetting, 10)
				: this.config.retentionDays;
			const validDays =
				isNaN(retentionDays) || retentionDays < 1 ? this.config.retentionDays : retentionDays;

			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - validDays);
			const cutoffISO = cutoffDate.toISOString();

			/* Find old deployments */
			const oldDeployments = await db
				.select({
					id: deployments.id,
					projectId: deployments.projectId,
					createdAt: deployments.createdAt
				})
				.from(deployments)
				.where(lt(deployments.createdAt, cutoffISO));

			/* Always clean up old cron runs regardless of deployments */
			await db.delete(cronRuns).where(lt(cronRuns.startedAt, cutoffISO));

			if (oldDeployments.length === 0) {
				return { deploymentsRemoved: 0, buildLogsRemoved: 0, cutoffDate: cutoffISO };
			}

			const allDeployments = await db
				.select({
					id: deployments.id,
					projectId: deployments.projectId,
					status: deployments.status,
					createdAt: deployments.createdAt
				})
				.from(deployments)
				.where(isNotNull(deployments.id));

			const deploymentsByProject = new Map<string, typeof allDeployments>();
			for (const deployment of allDeployments) {
				const projectDeployments = deploymentsByProject.get(deployment.projectId) ?? [];
				projectDeployments.push(deployment);
				deploymentsByProject.set(deployment.projectId, projectDeployments);
			}

			const protectedDeploymentIds = new Set<string>();
			for (const projectDeployments of deploymentsByProject.values()) {
				projectDeployments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

				for (const deployment of projectDeployments.slice(0, RETAINED_DEPLOYMENT_LOGS_PER_PROJECT)) {
					protectedDeploymentIds.add(deployment.id);
				}

				const latestLiveDeployment = projectDeployments.find(
					(deployment) => deployment.status === 'live'
				);
				if (latestLiveDeployment) {
					protectedDeploymentIds.add(latestLiveDeployment.id);
				}
			}

			const logDeploymentIds = oldDeployments
				.filter((deployment) => !protectedDeploymentIds.has(deployment.id))
				.map((deployment) => deployment.id);

			if (logDeploymentIds.length === 0) {
				return { deploymentsRemoved: 0, buildLogsRemoved: 0, cutoffDate: cutoffISO };
			}

			/* Delete build logs for old deployments outside the protected history window. */
			await db.delete(buildLogs).where(inArray(buildLogs.deploymentId, logDeploymentIds));

			return {
				deploymentsRemoved: 0,
				buildLogsRemoved: logDeploymentIds.length,
				cutoffDate: cutoffISO
			};
		} finally {
			this.running = false;
		}
	}

	/**
	 * Get Docker disk usage information by running `docker system df`.
	 */
	async getDockerDiskUsage(): Promise<DockerDiskUsage> {
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const execFileAsync = promisify(execFile);

		try {
			const { stdout } = await execFileAsync('docker', ['system', 'df', '--format', '{{json .}}']);
			const lines = stdout.trim().split('\n').filter(Boolean);

			const usage: DockerDiskUsage = {
				images: { count: 0, sizeFormatted: '0 B' },
				containers: { count: 0, sizeFormatted: '0 B' },
				volumes: { count: 0, sizeFormatted: '0 B' },
				buildCache: { sizeFormatted: '0 B' },
				totalFormatted: '0 B'
			};

			let totalBytes = 0;

			for (const line of lines) {
				const entry = JSON.parse(line);
				const type = (entry.Type || '').toLowerCase();
				const count = parseInt(entry.TotalCount || entry.Count || '0', 10);
				const size = entry.Size || '0B';

				if (type.includes('image')) {
					usage.images = { count, sizeFormatted: size };
				} else if (type.includes('container')) {
					usage.containers = { count, sizeFormatted: size };
				} else if (type.includes('volume')) {
					usage.volumes = { count, sizeFormatted: size };
				} else if (type.includes('build') || type.includes('cache')) {
					usage.buildCache = { sizeFormatted: size };
				}

				totalBytes += parseDockerSize(size);
			}

			usage.totalFormatted = formatBytes(totalBytes);
			return usage;
		} catch {
			return {
				images: { count: 0, sizeFormatted: '0 B' },
				containers: { count: 0, sizeFormatted: '0 B' },
				volumes: { count: 0, sizeFormatted: '0 B' },
				buildCache: { sizeFormatted: '0 B' },
				totalFormatted: '0 B'
			};
		}
	}

	/**
	 * Run Docker prune for the specified resource type. Volume pruning never
	 * touches the data or managed Postgres volume of an existing project.
	 */
	async dockerPrune(type: 'images' | 'containers' | 'volumes' | 'buildcache' | 'all'): Promise<DockerPruneResult> {
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const execFileAsync = promisify(execFile) as ExecFileFn;

		try {
			let stdout = '';
			let volumeBytes = 0;
			let prunedVolumes = false;

			if (type === 'all') {
				/* Resolve protected volumes first so a failed lookup prunes nothing. */
				const protectedVolumes = await this.getProtectedVolumes();
				const result = await execFileAsync('docker', ['system', 'prune', '-af']);
				stdout = result.stdout;
				volumeBytes = await this.pruneUnusedVolumes(execFileAsync, protectedVolumes);
				prunedVolumes = true;
			} else if (type === 'images') {
				const result = await execFileAsync('docker', ['image', 'prune', '-af']);
				stdout = result.stdout;
			} else if (type === 'containers') {
				const result = await execFileAsync('docker', ['container', 'prune', '-f']);
				stdout = result.stdout;
			} else if (type === 'volumes') {
				const protectedVolumes = await this.getProtectedVolumes();
				volumeBytes = await this.pruneUnusedVolumes(execFileAsync, protectedVolumes);
				prunedVolumes = true;
			} else if (type === 'buildcache') {
				const result = await execFileAsync('docker', ['builder', 'prune', '-af']);
				stdout = result.stdout;
			}

			const reclaimedMatch = stdout.match(/reclaimed\s+space:\s*(.+)/i);
			const reclaimed = reclaimedMatch?.[1]?.trim() || '0B';
			return {
				type,
				spaceReclaimed: prunedVolumes
					? formatBytes(parseDockerSize(reclaimed) + volumeBytes)
					: reclaimed
			};
		} catch {
			return { type, spaceReclaimed: '0B' };
		}
	}

	/**
	 * Volumes a prune must never delete: the data and managed Postgres volume of
	 * every existing project. App containers are removed (not just stopped) when
	 * a deployment is stopped or fails its health check, so Docker reports these
	 * volumes as unused even though they hold the app's data.
	 */
	private async getProtectedVolumes(): Promise<Set<string>> {
		const rows = await db.select({ id: projects.id }).from(projects);
		const names = new Set<string>();
		for (const { id } of rows) {
			names.add(projectVolumeName(id));
			names.add(managedPostgresVolumeName(id));
		}
		return names;
	}

	/**
	 * Remove unused volumes except the protected ones. Returns the bytes
	 * reclaimed. `docker volume rm` runs without -f so a volume that came back
	 * into use since it was listed is left alone.
	 */
	private async pruneUnusedVolumes(
		exec: ExecFileFn,
		protectedVolumes: Set<string>
	): Promise<number> {
		const { stdout } = await exec('docker', ['volume', 'ls', '-q', '--filter', 'dangling=true']);
		const names = stdout
			.split('\n')
			.map((name) => name.trim())
			.filter((name) => name && !protectedVolumes.has(name));
		if (names.length === 0) return 0;

		const sizes = await this.getVolumeSizes(exec);
		let reclaimed = 0;
		for (const name of names) {
			try {
				await exec('docker', ['volume', 'rm', name]);
				reclaimed += sizes.get(name) ?? 0;
			} catch {
				/* in use again or already gone */
			}
		}
		return reclaimed;
	}

	/** Volume sizes in bytes by name; empty when Docker cannot report them. */
	private async getVolumeSizes(exec: ExecFileFn): Promise<Map<string, number>> {
		const sizes = new Map<string, number>();
		try {
			const { stdout } = await exec('docker', ['system', 'df', '-v', '--format', '{{json .}}']);
			const usage = JSON.parse(stdout) as { Volumes?: Array<{ Name?: string; Size?: string }> };
			for (const volume of usage.Volumes ?? []) {
				if (volume.Name) sizes.set(volume.Name, parseDockerSize(volume.Size ?? '0B'));
			}
		} catch {
			/* sizes are only used for the reclaimed total */
		}
		return sizes;
	}
}

/** Parse Docker size strings like "1.5GB", "200MB", "10kB" to bytes. */
export function parseDockerSize(size: string): number {
	const match = size.match(/^([\d.]+)\s*(B|kB|KB|MB|GB|TB)$/i);
	if (!match) return 0;

	const value = parseFloat(match[1]);
	const unit = match[2].toUpperCase();
	const multipliers: Record<string, number> = {
		B: 1,
		KB: 1000,
		MB: 1000 * 1000,
		GB: 1000 * 1000 * 1000,
		TB: 1000 * 1000 * 1000 * 1000
	};

	return value * (multipliers[unit] || 1);
}

/** Format bytes to a compact human-readable string with 3 significant figures. */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
	const val = bytes / Math.pow(1000, i);
	if (i === 0) return `${Math.round(val)}${units[i]}`;
	const decimals = val >= 100 ? 0 : val >= 10 ? 1 : 2;
	return `${val.toFixed(decimals)}${units[i]}`;
}

/* Singleton */
let instance: CleanupManager | null = null;

export function getCleanupManager(): CleanupManager {
	if (!instance) {
		instance = new CleanupManager();
	}
	return instance;
}
