import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { healthEvents } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { requireAuth } from '$lib/server/api-utils';
import { getHealthMonitor } from '$lib/server/health';
import type { RequestHandler } from './$types';

/**
 * GET /api/health — get health status of all monitored containers.
 * Returns current health state and recent health events.
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const monitor = getHealthMonitor();
	const statuses = monitor.getAll();

	/* Fetch recent health events (last 50) */
	const recentEvents = await db
		.select()
		.from(healthEvents)
		.orderBy(desc(healthEvents.createdAt))
		.limit(50);

	return json({ statuses, events: recentEvents });
};

/**
 * GET /api/health/[projectId] — get health for a specific project.
 */
export const POST: RequestHandler = async (event) => {
	requireAuth(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object' || !('projectId' in body)) {
		return json({ error: 'projectId required' }, { status: 400 });
	}

	const { projectId } = body as { projectId: string };
	const monitor = getHealthMonitor();
	const status = monitor.get(projectId);

	const events = await db
		.select()
		.from(healthEvents)
		.where(eq(healthEvents.projectId, projectId))
		.orderBy(desc(healthEvents.createdAt))
		.limit(20);

	return json({ status: status ?? null, events });
};
