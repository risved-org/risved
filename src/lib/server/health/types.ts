/** Health status for a single project container */
export interface ContainerHealth {
	projectId: string;
	projectSlug: string;
	port: number;
	healthy: boolean;
	consecutiveFailures: number;
	lastCheckAt: string | null;
	lastRestartAt: string | null;
	totalRestarts: number;
}

/** Health event types */
export type HealthEventType = 'check_failed' | 'restarted' | 'recovered';

/** A health event record */
export interface HealthEvent {
	id: string;
	projectId: string;
	event: HealthEventType;
	message: string;
	createdAt: string;
}

/** Configuration for the health monitor */
export interface HealthMonitorConfig {
	/** Interval between health checks in ms (default: 30000) */
	intervalMs?: number;
	/** Number of consecutive failures before restart (default: 3) */
	failureThreshold?: number;
	/** HTTP timeout for health check requests in ms (default: 5000) */
	checkTimeoutMs?: number;
	/** Custom fetch function for testing */
	fetchFn?: typeof fetch;
}
