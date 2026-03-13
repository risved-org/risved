export interface CleanupConfig {
	/** Build log retention in days (default: 30) */
	retentionDays: number;
	/** Interval between cleanup runs in ms (default: 24h) */
	intervalMs: number;
}

export interface CleanupResult {
	deploymentsRemoved: number;
	buildLogsRemoved: number;
	cutoffDate: string;
}

export interface DockerDiskUsage {
	images: { count: number; sizeFormatted: string };
	containers: { count: number; sizeFormatted: string };
	volumes: { count: number; sizeFormatted: string };
	buildCache: { sizeFormatted: string };
	totalFormatted: string;
}

export interface DockerPruneResult {
	type: 'images' | 'containers' | 'volumes' | 'all';
	spaceReclaimed: string;
}
