export interface ContainerStats {
	projectId: string;
	containerName: string;
	cpuPercent: number;
	memoryMb: number;
	memoryLimitMb: number;
	/** Short container ID, used to notice when a container was replaced */
	containerId?: string;
	/** Cumulative bytes received since the container started */
	netRxBytes?: number;
	/** Cumulative bytes sent since the container started */
	netTxBytes?: number;
}

export interface MetricPoint {
	bucket: string;
	cpuPercent: number;
	memoryMb: number;
	memoryLimitMb: number;
	sampleCount: number;
}

export interface MetricsCollectorConfig {
	intervalMs?: number;
	retentionDays?: number;
	execFn?: (cmd: string) => string;
}
