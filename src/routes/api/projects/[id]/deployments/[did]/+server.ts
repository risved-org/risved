import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deployments, buildLogs } from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import type { RequestHandler } from './$types';

/**
 * GET /api/projects/:id/deployments/:did — deployment detail with build logs.
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const { id, did } = event.params;

	const rows = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, did), eq(deployments.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Deployment not found');
	}

	const deployment = rows[0];

	const logs = await db
		.select()
		.from(buildLogs)
		.where(eq(buildLogs.deploymentId, did))
		.orderBy(asc(buildLogs.timestamp));

	return json({
		...deployment,
		logs
	});
};
