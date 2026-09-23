import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, deployments } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { runRollback } from '$lib/server/pipeline/rollback';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import type { RequestHandler } from './$types';

/** Deployments that reached production; superseded ones were replaced by a newer deploy. */
const ROLLBACK_STATUSES = new Set(['live', 'superseded', 'stopped']);

/**
 * POST /api/projects/:id/deployments/:did/rollback — rollback to this deployment.
 * Re-deploys the cached Docker image without rebuilding.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, did } = event.params;

	/* Find the project */
	const projRows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
	if (projRows.length === 0) {
		return jsonError(404, 'Project not found');
	}
	const project = projRows[0];

	if (!project.port) {
		return jsonError(400, 'Project has no port allocated');
	}

	/* Find the target deployment */
	const depRows = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, did), eq(deployments.projectId, id)))
		.limit(1);

	if (depRows.length === 0) {
		return jsonError(404, 'Deployment not found');
	}

	const deployment = depRows[0];

	if (!ROLLBACK_STATUSES.has(deployment.status)) {
		return jsonError(400, 'Can only rollback to a previously successful deployment');
	}

	if (!deployment.imageTag) {
		return jsonError(400, 'Deployment has no cached image to rollback to');
	}

	const result = await runRollback(
		{
			projectId: project.id,
			projectSlug: project.slug,
			imageTag: deployment.imageTag,
			commitSha: deployment.commitSha,
			port: project.port,
			domain: project.domain ?? undefined,
			postgresEnabled: project.postgresEnabled,
			postgresPassword: project.postgresPassword
		},
		createCommandRunner()
	);

	return json(
		{
			success: result.success,
			deploymentId: result.deploymentId,
			error: result.error
		},
		{ status: result.success ? 200 : 500 }
	);
};
