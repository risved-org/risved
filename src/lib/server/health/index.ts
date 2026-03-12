import { db } from '$lib/server/db';
import { projects, deployments, healthEvents as healthEventsTable } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import { execSync } from 'node:child_process';
import type { ContainerHealth, HealthMonitorConfig, HealthEventType } from './types';

export type { ContainerHealth, HealthEvent, HealthEventType, HealthMonitorConfig } from './types';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_CHECK_TIMEOUT_MS = 5_000;

/**
 * Monitors container health and auto-restarts on consecutive failures.
 * Runs periodic HTTP GET checks against each project's port.
 */
export class HealthMonitor {
	private intervalMs: number;
	private failureThreshold: number;
	private checkTimeoutMs: number;
	private fetchFn: typeof fetch;
	private timer: ReturnType<typeof setInterval> | null = null;
	private state = new Map<string, ContainerHealth>();
	private running = false;

	constructor(config: HealthMonitorConfig = {}) {
		this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.failureThreshold = config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
		this.checkTimeoutMs = config.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
		this.fetchFn = config.fetchFn ?? globalThis.fetch;
	}

	/** Start the periodic health check loop */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.timer = setInterval(() => this.checkAll(), this.intervalMs);
	}

	/** Stop the health check loop */
	stop(): void {
		this.running = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Get health status for all monitored projects */
	getAll(): ContainerHealth[] {
		return Array.from(this.state.values());
	}

	/** Get health status for a specific project */
	get(projectId: string): ContainerHealth | undefined {
		return this.state.get(projectId);
	}

	/**
	 * Run health checks for all projects with live deployments.
	 * Called automatically by the interval timer.
	 */
	async checkAll(): Promise<void> {
		const liveProjects = await this.getLiveProjects();

		/* Remove stale entries for projects no longer live */
		for (const id of this.state.keys()) {
			if (!liveProjects.some((p) => p.id === id)) {
				this.state.delete(id);
			}
		}

		/* Check each live project */
		await Promise.allSettled(liveProjects.map((p) => this.checkOne(p.id, p.slug, p.port)));
	}

	/**
	 * Check a single container's health via HTTP GET.
	 * Tracks consecutive failures and triggers restart at threshold.
	 */
	async checkOne(projectId: string, slug: string, port: number): Promise<boolean> {
		const now = new Date().toISOString();
		let entry = this.state.get(projectId);
		if (!entry) {
			entry = {
				projectId,
				projectSlug: slug,
				port,
				healthy: true,
				consecutiveFailures: 0,
				lastCheckAt: null,
				lastRestartAt: null,
				totalRestarts: 0
			};
			this.state.set(projectId, entry);
		}

		entry.lastCheckAt = now;
		entry.port = port;

		const healthy = await this.httpCheck(port);

		if (healthy) {
			if (!entry.healthy && entry.consecutiveFailures > 0) {
				/* Container recovered */
				await this.logEvent(
					projectId,
					'recovered',
					`Container recovered after ${entry.consecutiveFailures} failures`
				);
			}
			entry.healthy = true;
			entry.consecutiveFailures = 0;
			return true;
		}

		entry.consecutiveFailures++;
		entry.healthy = false;
		await this.logEvent(
			projectId,
			'check_failed',
			`Health check failed (${entry.consecutiveFailures}/${this.failureThreshold})`
		);

		if (entry.consecutiveFailures >= this.failureThreshold) {
			await this.restartContainer(entry);
		}

		return false;
	}

	/** HTTP GET health check against a container port */
	private async httpCheck(port: number): Promise<boolean> {
		try {
			const res = await this.fetchFn(`http://localhost:${port}/`, {
				signal: AbortSignal.timeout(this.checkTimeoutMs)
			});
			return res.ok || res.status < 500;
		} catch {
			return false;
		}
	}

	/** Restart a failed container using Docker */
	private async restartContainer(entry: ContainerHealth): Promise<void> {
		const containerName = entry.projectSlug;
		try {
			execSync(`docker restart ${containerName}`, { timeout: 30_000 });
			entry.consecutiveFailures = 0;
			entry.lastRestartAt = new Date().toISOString();
			entry.totalRestarts++;
			await this.logEvent(
				entry.projectId,
				'restarted',
				`Container auto-restarted after ${this.failureThreshold} consecutive failures`
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error';
			await this.logEvent(entry.projectId, 'check_failed', `Restart failed: ${msg}`);
		}
	}

	/** Log a health event to the database */
	private async logEvent(
		projectId: string,
		event: HealthEventType,
		message: string
	): Promise<void> {
		try {
			await db.insert(healthEventsTable).values({
				projectId,
				event,
				message
			});
		} catch {
			/* DB write failed — non-fatal */
		}
	}

	/** Fetch projects with a live deployment and a port */
	private async getLiveProjects(): Promise<Array<{ id: string; slug: string; port: number }>> {
		const allProjects = await db.select().from(projects);
		const allDeps = await db.select().from(deployments).orderBy(desc(deployments.createdAt));

		/* Build map of latest deployment per project */
		const latestDep = new Map<string, string>();
		for (const dep of allDeps) {
			if (!latestDep.has(dep.projectId)) {
				latestDep.set(dep.projectId, dep.status);
			}
		}

		return allProjects
			.filter((p) => p.port && latestDep.get(p.id) === 'live')
			.map((p) => ({ id: p.id, slug: p.slug, port: p.port! }));
	}
}

/** Singleton health monitor instance */
let instance: HealthMonitor | null = null;

/** Get or create the singleton HealthMonitor */
export function getHealthMonitor(config?: HealthMonitorConfig): HealthMonitor {
	if (!instance) {
		instance = new HealthMonitor(config);
	}
	return instance;
}

/** Reset the singleton (for testing) */
export function _resetHealthMonitor(): void {
	if (instance) {
		instance.stop();
		instance = null;
	}
}
