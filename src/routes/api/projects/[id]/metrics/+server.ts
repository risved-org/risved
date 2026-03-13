import { json } from '@sveltejs/kit';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { db } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getProjectMetrics } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

/** GET /api/projects/:id/metrics?hours=24 — returns time-series resource metrics */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id } = event.params;
	const hours = Math.min(parseInt(event.url.searchParams.get('hours') ?? '24', 10) || 24, 168);

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
	if (proj.length === 0) return jsonError(404, 'Project not found');

	const metrics = await getProjectMetrics(id, hours);
	return json({ metrics });
};
