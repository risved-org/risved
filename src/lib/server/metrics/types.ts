export interface ContainerStats {
	projectId: string;
	containerName: string;
	cpuPercent: number;
	memoryMb: number;
	memoryLimitMb: number;
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
