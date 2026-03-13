import { db } from '$lib/server/db';
import { deployments, buildLogs } from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import type { RequestHandler } from './$types';

/**
 * GET /api/projects/:id/deployments/:did/logs
 *
 * Returns build logs as an SSE stream. If the deployment is still running,
 * the stream stays open and polls for new logs every 2 seconds.
 * Once the deployment reaches a terminal status (live, failed, stopped),
 * the stream sends all remaining logs and closes.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, did } = event.params;

	/* Verify deployment exists and belongs to the project */
	const rows = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, did), eq(deployments.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Deployment not found');
	}

	const deployment = rows[0];
	const isTerminal = ['live', 'failed', 'stopped'].includes(deployment.status);

	/* For terminal deployments, return all logs at once and close */
	if (isTerminal) {
		const logs = await db
			.select()
			.from(buildLogs)
			.where(eq(buildLogs.deploymentId, did))
			.orderBy(asc(buildLogs.timestamp));

		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				for (const log of logs) {
					const data = JSON.stringify({
						timestamp: log.timestamp,
						phase: log.phase,
						level: log.level,
						message: log.message
					});
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				}
				controller.enqueue(encoder.encode(`event: done\ndata: ${deployment.status}\n\n`));
				controller.close();
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	}

	/* For in-progress deployments, poll for new logs */
	let lastId = 0;
	let closed = false;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			while (!closed) {
				const logs = await db
					.select()
					.from(buildLogs)
					.where(eq(buildLogs.deploymentId, did))
					.orderBy(asc(buildLogs.id));

				const newLogs = logs.filter((l) => l.id > lastId);

				for (const log of newLogs) {
					const data = JSON.stringify({
						timestamp: log.timestamp,
						phase: log.phase,
						level: log.level,
						message: log.message
					});
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
					lastId = log.id;
				}

				/* Check if deployment finished */
				const current = await db
					.select()
					.from(deployments)
					.where(eq(deployments.id, did))
					.limit(1);

				if (
					current.length === 0 ||
					['live', 'failed', 'stopped'].includes(current[0].status)
				) {
					const status = current[0]?.status ?? 'unknown';
					controller.enqueue(encoder.encode(`event: done\ndata: ${status}\n\n`));
					controller.close();
					closed = true;
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		},
		cancel() {
			closed = true;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
