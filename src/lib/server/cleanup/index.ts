import { db } from '$lib/server/db';
import { deployments, buildLogs, cronRuns } from '$lib/server/db/schema';
import { lt, inArray } from 'drizzle-orm';
import { getSetting } from '$lib/server/settings';
import type { CleanupConfig, CleanupResult, DockerDiskUsage, DockerPruneResult } from './types';

const DEFAULT_CONFIG: CleanupConfig = {
	retentionDays: 30,
	intervalMs: 24 * 60 * 60 * 1000
};

/**
 * CleanupManager handles periodic build log retention
 * and provides Docker disk usage / prune operations.
 */
export class CleanupManager {
	private config: CleanupConfig;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(config: Partial<CleanupConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/** Start periodic cleanup runs. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.runCleanup(), this.config.intervalMs);
		/* Run once on start after a short delay */
		setTimeout(() => this.runCleanup(), 5000);
	}

	/** Stop periodic cleanup. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	isRunning(): boolean {
		return this.timer !== null;
	}

	/**
	 * Delete old deployment records and their build logs
	 * based on the configured retention period.
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
				.select({ id: deployments.id })
				.from(deployments)
				.where(lt(deployments.createdAt, cutoffISO));

			/* Always clean up old cron runs regardless of deployments */
			await db.delete(cronRuns).where(lt(cronRuns.startedAt, cutoffISO));

			if (oldDeployments.length === 0) {
				return { deploymentsRemoved: 0, buildLogsRemoved: 0, cutoffDate: cutoffISO };
			}

			const deploymentIds = oldDeployments.map((d) => d.id);

			/* Delete build logs for those deployments */
			await db.delete(buildLogs).where(inArray(buildLogs.deploymentId, deploymentIds));

			/* Delete the deployment records */
			await db.delete(deployments).where(inArray(deployments.id, deploymentIds));

			return {
				deploymentsRemoved: deploymentIds.length,
				buildLogsRemoved: deploymentIds.length,
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
				images: { count: 0, sizeFormatted: '0B' },
				containers: { count: 0, sizeFormatted: '0B' },
				volumes: { count: 0, sizeFormatted: '0B' },
				buildCache: { sizeFormatted: '0B' },
				totalFormatted: '0B'
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
				images: { count: 0, sizeFormatted: '0B' },
				containers: { count: 0, sizeFormatted: '0B' },
				volumes: { count: 0, sizeFormatted: '0B' },
				buildCache: { sizeFormatted: '0B' },
				totalFormatted: '0B'
			};
		}
	}

	/**
	 * Run Docker prune for the specified resource type.
	 */
	async dockerPrune(type: 'images' | 'containers' | 'volumes' | 'all'): Promise<DockerPruneResult> {
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const execFileAsync = promisify(execFile);

		try {
			let stdout = '';

			if (type === 'all') {
				const result = await execFileAsync('docker', ['system', 'prune', '-af', '--volumes']);
				stdout = result.stdout;
			} else if (type === 'images') {
				const result = await execFileAsync('docker', ['image', 'prune', '-af']);
				stdout = result.stdout;
			} else if (type === 'containers') {
				const result = await execFileAsync('docker', ['container', 'prune', '-f']);
				stdout = result.stdout;
			} else if (type === 'volumes') {
				const result = await execFileAsync('docker', ['volume', 'prune', '-af']);
				stdout = result.stdout;
			}

			const reclaimedMatch = stdout.match(/reclaimed\s+space:\s*(.+)/i);
			return {
				type,
				spaceReclaimed: reclaimedMatch?.[1]?.trim() || '0B'
			};
		} catch {
			return { type, spaceReclaimed: '0B' };
		}
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

/** Format bytes to a human-readable string. */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1000));
	const val = bytes / Math.pow(1000, i);
	return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)}${units[i]}`;
}

/* Singleton */
let instance: CleanupManager | null = null;

export function getCleanupManager(): CleanupManager {
	if (!instance) {
		instance = new CleanupManager();
	}
	return instance;
}
