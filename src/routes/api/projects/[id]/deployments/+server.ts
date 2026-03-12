import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, deployments } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import type { RequestHandler } from './$types';

/**
 * GET /api/projects/:id/deployments — list deployments for a project.
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const { id } = event.params;

	/* Verify project exists */
	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
	if (proj.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const rows = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, id))
		.orderBy(desc(deployments.createdAt));

	return json(rows);
};
