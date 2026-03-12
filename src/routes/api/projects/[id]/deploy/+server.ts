import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { runPipeline } from '$lib/server/pipeline';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import type { FrameworkId, Tier } from '$lib/server/detection/types';
import type { RequestHandler } from './$types';

/**
 * POST /api/projects/:id/deploy — trigger a manual deployment.
 */
export const POST: RequestHandler = async (event) => {
	requireAuth(event);

	const { id } = event.params;
	const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const project = rows[0];

	if (!project.port) {
		return jsonError(400, 'Project has no port allocated');
	}

	const result = await runPipeline(
		{
			projectId: project.id,
			projectSlug: project.slug,
			repoUrl: project.repoUrl,
			branch: project.branch,
			port: project.port,
			domain: project.domain ?? undefined,
			frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
			tier: (project.tier as Tier) ?? undefined
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
