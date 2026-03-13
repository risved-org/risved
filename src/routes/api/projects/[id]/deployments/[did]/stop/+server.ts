import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deployments } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { createCommandRunner, dockerStop } from '$lib/server/pipeline/docker';
import type { RequestHandler } from './$types';

/**
 * POST /api/projects/:id/deployments/:did/stop — stop a deployment's container.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

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

	if (!deployment.containerName) {
		return jsonError(400, 'Deployment has no running container');
	}

	if (deployment.status === 'stopped') {
		return jsonError(400, 'Deployment is already stopped');
	}

	/* Stop container (best-effort) */
	try {
		const runner = createCommandRunner();
		await dockerStop(runner, deployment.containerName, 10);
	} catch {
		/* Container may already be gone */
	}

	/* Update deployment status */
	const [updated] = await db
		.update(deployments)
		.set({ status: 'stopped', finishedAt: new Date().toISOString() })
		.where(eq(deployments.id, did))
		.returning();

	return json(updated);
};
