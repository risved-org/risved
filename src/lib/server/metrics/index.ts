import { db } from '$lib/server/db';
import { projects, deployments, resourceMetrics, bandwidthDaily } from '$lib/server/db/schema';
import { desc, eq, and, gte, lt, sql } from 'drizzle-orm';
import { execSync } from 'node:child_process';
import { parseDockerSize } from './size';
import type { ContainerStats, MetricPoint, MetricsCollectorConfig } from './types';

export type { ContainerStats, MetricPoint, MetricsCollectorConfig } from './types';
export { parseDockerSize } from './size';

const DEFAULT_INTERVAL_MS = 60_000; // collect every minute
const DEFAULT_RETENTION_DAYS = 7;
/* Daily bandwidth totals must outlive the 30-day window the heartbeat reports */
const BANDWIDTH_RETENTION_DAYS = 31;

/** Truncate a date to the current hour bucket (ISO string) */
export function toBucket(date: Date): string {
	const d = new Date(date);
	d.setMinutes(0, 0, 0);
	return d.toISOString();
}

/** UTC calendar day (YYYY-MM-DD) used as the bandwidth bucket */
export function toDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Parse docker's NetIO column ("98.7MB / 57.7MB") into [rxBytes, txBytes] */
export function parseNetIo(value: string): [number, number] {
	const [rx, tx] = value.split('/');
	return [parseDockerSize(rx ?? ''), parseDockerSize(tx ?? '')];
}

interface NetSample {
	containerId?: string;
	rx: number;
	tx: number;
}

/**
 * Parse docker stats output into container stats.
 * Expects `docker stats --no-stream --format` output.
 */
export function parseDockerStats(
	output: string,
	containerMap: Map<string, string>
): ContainerStats[] {
	const results: ContainerStats[] = [];
	for (const line of output.trim().split('\n')) {
		if (!line.trim()) continue;
		// Format: name|cpuPercent|memUsage|memLimit
		const parts = line.split('|');
		if (parts.length < 4) continue;

		const name = parts[0].trim();
		const projectId = containerMap.get(name);
		if (!projectId) continue;

		const cpuPercent = Math.round(parseFloat(parts[1].replace('%', '')) * 100) / 100;
		const memoryMb = parseMem(parts[2].trim());
		const memoryLimitMb = parseMem(parts[3].trim());

		results.push({ projectId, containerName: name, cpuPercent, memoryMb, memoryLimitMb });
	}
	return results;
}

/** Parse memory string like "128.5MiB" or "1.2GiB" to MB */
function parseMem(s: string): number {
	const match = s.match(/([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB|B)/i);
	if (!match) return 0;
	const val = parseFloat(match[1]);
	const unit = match[2].toLowerCase();
	if (unit === 'gib' || unit === 'gb') return Math.round(val * 1024);
	if (unit === 'mib' || unit === 'mb') return Math.round(val);
	if (unit === 'kib' || unit === 'kb') return Math.round(val / 1024);
	return 0;
}

/**
 * Collects container resource metrics and stores hourly aggregations.
 * Runs on a periodic interval, merging samples into hourly buckets.
 */
export class MetricsCollector {
	private intervalMs: number;
	private retentionDays: number;
	private execFn: (cmd: string) => string;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	/** Last cumulative network counters seen per project, for delta calculation */
	private lastNetIo = new Map<string, NetSample>();

	constructor(config: MetricsCollectorConfig = {}) {
		this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.retentionDays = config.retentionDays ?? DEFAULT_RETENTION_DAYS;
		this.execFn =
			config.execFn ?? ((cmd: string) => execSync(cmd, { encoding: 'utf8', timeout: 10_000 }));
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.timer = setInterval(() => this.collect(), this.intervalMs);
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Collect metrics from all live containers and store in DB */
	async collect(): Promise<void> {
		try {
			const containerMap = await this.getLiveContainerMap();
			if (containerMap.size === 0) return;

			const names = Array.from(containerMap.keys()).join(' ');
			const format = '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.ID}}';
			const output = this.execFn(`docker stats --no-stream --format "${format}" ${names}`);

			const stats = parseStatsOutput(output, containerMap);
			const now = new Date();
			const bucket = toBucket(now);
			const day = toDay(now);

			for (const stat of stats) {
				await this.upsertMetric(stat, bucket);
				await this.recordBandwidth(stat, day);
			}

			await this.pruneOldMetrics();
		} catch {
			/* Collection failed — non-fatal */
		}
	}

	/** Upsert metric into hourly bucket (running average) */
	private async upsertMetric(stat: ContainerStats, bucket: string): Promise<void> {
		const existing = await db
			.select()
			.from(resourceMetrics)
			.where(and(eq(resourceMetrics.projectId, stat.projectId), eq(resourceMetrics.bucket, bucket)))
			.limit(1);

		if (existing.length > 0) {
			const row = existing[0];
			const newCount = row.sampleCount + 1;
			const avgCpu = Math.round(
				(row.cpuPercent * row.sampleCount + stat.cpuPercent * 100) / newCount
			);
			const avgMem = Math.round((row.memoryMb * row.sampleCount + stat.memoryMb) / newCount);
			await db
				.update(resourceMetrics)
				.set({
					cpuPercent: avgCpu,
					memoryMb: avgMem,
					memoryLimitMb: stat.memoryLimitMb,
					sampleCount: newCount
				})
				.where(eq(resourceMetrics.id, row.id));
		} else {
			await db.insert(resourceMetrics).values({
				projectId: stat.projectId,
				cpuPercent: Math.round(stat.cpuPercent * 100),
				memoryMb: stat.memoryMb,
				memoryLimitMb: stat.memoryLimitMb,
				bucket,
				sampleCount: 1
			});
		}
	}

	/**
	 * Add the traffic since the previous sample to today's bandwidth bucket.
	 *
	 * Docker reports network I/O as cumulative totals since the container
	 * started, so bandwidth is the difference between consecutive samples.
	 * The first sample after a control plane restart only sets the baseline.
	 * A new container ID or a counter that went backwards means the container
	 * was replaced or restarted, so its whole counter is new traffic.
	 */
	private async recordBandwidth(stat: ContainerStats, day: string): Promise<void> {
		if (stat.netRxBytes === undefined || stat.netTxBytes === undefined) return;

		const previous = this.lastNetIo.get(stat.projectId);
		this.lastNetIo.set(stat.projectId, {
			containerId: stat.containerId,
			rx: stat.netRxBytes,
			tx: stat.netTxBytes
		});
		if (!previous) return;

		const restarted =
			previous.containerId !== stat.containerId ||
			stat.netRxBytes < previous.rx ||
			stat.netTxBytes < previous.tx;
		const rx = restarted ? stat.netRxBytes : stat.netRxBytes - previous.rx;
		const tx = restarted ? stat.netTxBytes : stat.netTxBytes - previous.tx;
		if (rx <= 0 && tx <= 0) return;

		const updatedAt = new Date().toISOString();
		await db
			.insert(bandwidthDaily)
			.values({ projectId: stat.projectId, day, rxBytes: rx, txBytes: tx, updatedAt })
			.onConflictDoUpdate({
				target: [bandwidthDaily.projectId, bandwidthDaily.day],
				set: {
					rxBytes: sql`${bandwidthDaily.rxBytes} + ${rx}`,
					txBytes: sql`${bandwidthDaily.txBytes} + ${tx}`,
					updatedAt
				}
			});
	}

	/** Remove metrics older than retention period */
	private async pruneOldMetrics(): Promise<void> {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - this.retentionDays);
		await db.delete(resourceMetrics).where(lt(resourceMetrics.bucket, cutoff.toISOString()));

		const dayCutoff = new Date();
		dayCutoff.setUTCDate(dayCutoff.getUTCDate() - BANDWIDTH_RETENTION_DAYS);
		await db.delete(bandwidthDaily).where(lt(bandwidthDaily.day, toDay(dayCutoff)));
	}

	/** Build a map of containerName -> projectId for live projects */
	private async getLiveContainerMap(): Promise<Map<string, string>> {
		const allProjects = await db.select().from(projects);
		const allDeps = await db.select().from(deployments).orderBy(desc(deployments.createdAt));

		const latestDep = new Map<string, string>();
		for (const dep of allDeps) {
			if (!latestDep.has(dep.projectId)) {
				latestDep.set(dep.projectId, dep.status);
			}
		}

		const map = new Map<string, string>();
		for (const p of allProjects) {
			if (p.port && latestDep.get(p.id) === 'live') {
				map.set(p.slug, p.id);
			}
		}
		return map;
	}
}

/**
 * Parse docker stats output into container stats.
 * Format: Name|CPUPerc|MemUsage (e.g. "myapp|2.50%|128MiB / 1GiB")
 */
export function parseStatsOutput(
	output: string,
	containerMap: Map<string, string>
): ContainerStats[] {
	const results: ContainerStats[] = [];
	for (const line of output.trim().split('\n')) {
		if (!line.trim()) continue;
		const parts = line.split('|');
		if (parts.length < 3) continue;

		const name = parts[0].trim();
		const projectId = containerMap.get(name);
		if (!projectId) continue;

		const cpuPercent = Math.round(parseFloat(parts[1].replace('%', '')) * 100) / 100;

		// MemUsage format: "128MiB / 1GiB"
		const memParts = parts[2].split('/');
		const memoryMb = parseMem(memParts[0]?.trim() ?? '0');
		const memoryLimitMb = parseMem(memParts[1]?.trim() ?? '0');

		const stat: ContainerStats = {
			projectId,
			containerName: name,
			cpuPercent,
			memoryMb,
			memoryLimitMb
		};

		// Optional NetIO ("1.2MB / 3.4MB") and container ID columns
		if (parts[3]?.trim()) {
			[stat.netRxBytes, stat.netTxBytes] = parseNetIo(parts[3]);
		}
		if (parts[4]?.trim()) {
			stat.containerId = parts[4].trim();
		}

		results.push(stat);
	}
	return results;
}

/**
 * Total bytes in and out across all projects over the last `days` calendar
 * days (UTC, today inclusive).
 */
export async function getBandwidthBytes(days: number = 30): Promise<number> {
	const since = new Date();
	since.setUTCDate(since.getUTCDate() - (days - 1));

	const rows = await db
		.select({ rxBytes: bandwidthDaily.rxBytes, txBytes: bandwidthDaily.txBytes })
		.from(bandwidthDaily)
		.where(gte(bandwidthDaily.day, toDay(since)));

	return rows.reduce((sum, r) => sum + r.rxBytes + r.txBytes, 0);
}

/** Query metrics for a project within a time range */
export async function getProjectMetrics(
	projectId: string,
	hours: number = 24
): Promise<MetricPoint[]> {
	const since = new Date();
	since.setHours(since.getHours() - hours);

	const rows = await db
		.select()
		.from(resourceMetrics)
		.where(
			and(
				eq(resourceMetrics.projectId, projectId),
				gte(resourceMetrics.bucket, since.toISOString())
			)
		)
		.orderBy(resourceMetrics.bucket);

	return rows.map((r) => ({
		bucket: r.bucket,
		cpuPercent: r.cpuPercent / 100, // stored as integer * 100
		memoryMb: r.memoryMb,
		memoryLimitMb: r.memoryLimitMb,
		sampleCount: r.sampleCount
	}));
}

/** Query aggregate metrics across all projects */
export async function getServerMetrics(hours: number = 24): Promise<MetricPoint[]> {
	const since = new Date();
	since.setHours(since.getHours() - hours);

	const rows = await db
		.select()
		.from(resourceMetrics)
		.where(gte(resourceMetrics.bucket, since.toISOString()))
		.orderBy(resourceMetrics.bucket);

	// Aggregate by bucket across all projects
	const bucketMap = new Map<
		string,
		{ cpu: number; mem: number; memLimit: number; count: number }
	>();
	for (const r of rows) {
		const existing = bucketMap.get(r.bucket);
		if (existing) {
			existing.cpu += r.cpuPercent;
			existing.mem += r.memoryMb;
			existing.memLimit += r.memoryLimitMb;
			existing.count += r.sampleCount;
		} else {
			bucketMap.set(r.bucket, {
				cpu: r.cpuPercent,
				mem: r.memoryMb,
				memLimit: r.memoryLimitMb,
				count: r.sampleCount
			});
		}
	}

	return Array.from(bucketMap.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([bucket, d]) => ({
			bucket,
			cpuPercent: d.cpu / 100,
			memoryMb: d.mem,
			memoryLimitMb: d.memLimit,
			sampleCount: d.count
		}));
}

/** Singleton metrics collector */
let instance: MetricsCollector | null = null;

export function getMetricsCollector(config?: MetricsCollectorConfig): MetricsCollector {
	if (!instance) {
		instance = new MetricsCollector(config);
	}
	return instance;
}

export function _resetMetricsCollector(): void {
	if (instance) {
		instance.stop();
		instance = null;
	}
}
