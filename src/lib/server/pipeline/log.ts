import { db } from '$lib/server/db';
import { buildLogs } from '$lib/server/db/schema';
import type { LogEntry, LogEmitter, LogLevel, PipelinePhase } from './types';

/**
 * Create a log collector that stores entries in memory and optionally
 * forwards them to a streaming emitter (SSE/WebSocket).
 */
export function createLogCollector(
	deploymentId: string,
	streamEmitter?: LogEmitter
): {
	emit: (phase: PipelinePhase, message: string, level?: LogLevel) => void;
	entries: LogEntry[];
} {
	const entries: LogEntry[] = [];

	function emit(phase: PipelinePhase, message: string, level: LogLevel = 'info') {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			phase,
			level,
			message
		};
		entries.push(entry);
		streamEmitter?.(entry);

		/* Persist immediately so the SSE polling endpoint can pick it up */
		db.insert(buildLogs)
			.values({ deploymentId, timestamp: entry.timestamp, phase, level, message })
			.catch(() => {})
	}

	return { emit, entries };
}

/**
 * Persist all collected log entries to the database in a single batch.
 */
export async function persistLogs(deploymentId: string, entries: LogEntry[]): Promise<void> {
	if (entries.length === 0) return;

	await db.insert(buildLogs).values(
		entries.map((e) => ({
			deploymentId,
			timestamp: e.timestamp,
			phase: e.phase,
			level: e.level,
			message: e.message
		}))
	);
}
