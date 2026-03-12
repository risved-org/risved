import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, deployments } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { createCommandRunner, dockerStop } from '$lib/server/pipeline/docker';
import { CaddyClient } from '$lib/server/caddy';
import type { RequestHandler } from './$types';

/**
 * GET /api/projects/:id — get project detail with latest deployment.
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const { id } = event.params;
	const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const project = rows[0];

	const latestDeployments = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, id))
		.orderBy(desc(deployments.createdAt))
		.limit(1);

	return json({
		...project,
		latestDeployment: latestDeployments[0] ?? null
	});
};

/**
 * PUT /api/projects/:id — update project settings.
 * Body: { name?, branch?, framework_id?, domain? }
 */
export const PUT: RequestHandler = async (event) => {
	requireAuth(event);

	const { id } = event.params;
	const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	const { name, branch, framework_id, domain } = body as Record<string, unknown>;

	if (name !== undefined) {
		if (typeof name !== 'string' || name.trim().length === 0) {
			return jsonError(400, 'name must be a non-empty string');
		}
		updates.name = name.trim();
	}
	if (branch !== undefined) {
		if (typeof branch !== 'string' || branch.trim().length === 0) {
			return jsonError(400, 'branch must be a non-empty string');
		}
		updates.branch = branch.trim();
	}
	if (framework_id !== undefined) {
		updates.frameworkId = typeof framework_id === 'string' ? framework_id : null;
	}
	if (domain !== undefined) {
		updates.domain = typeof domain === 'string' ? domain : null;
	}

	const [updated] = await db
		.update(projects)
		.set(updates)
		.where(eq(projects.id, id))
		.returning();

	return json(updated);
};

/**
 * DELETE /api/projects/:id — delete project, stop container, remove Caddy routes.
 */
export const DELETE: RequestHandler = async (event) => {
	requireAuth(event);

	const { id } = event.params;
	const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const project = rows[0];

	/* Stop the running container (best-effort) */
	try {
		const runner = createCommandRunner();
		await dockerStop(runner, project.slug, 10);
	} catch {
		/* Container may not be running — ignore */
	}

	/* Remove Caddy route (best-effort) */
	if (project.domain) {
		try {
			const caddy = new CaddyClient();
			await caddy.removeRoute(project.domain);
		} catch {
			/* Caddy may not be running — ignore */
		}
	}

	/* Delete deployments then project */
	await db.delete(deployments).where(eq(deployments.projectId, id));
	await db.delete(projects).where(eq(projects.id, id));

	return json({ success: true });
};
