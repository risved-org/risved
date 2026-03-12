import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { requireAuth, slugify, generateWebhookSecret, jsonError } from '$lib/server/api-utils';
import { allocatePort } from '$lib/server/pipeline/port';
import type { RequestHandler } from './$types';

/**
 * GET /api/projects — list all projects with their latest deployment status.
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));

	return json(rows);
};

/**
 * POST /api/projects — create a new project.
 * Body: { name, git_url, branch?, framework_id? }
 */
export const POST: RequestHandler = async (event) => {
	requireAuth(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { name, git_url, branch, framework_id } = body as Record<string, unknown>;

	if (!name || typeof name !== 'string' || name.trim().length === 0) {
		return jsonError(400, 'name is required');
	}
	if (!git_url || typeof git_url !== 'string' || git_url.trim().length === 0) {
		return jsonError(400, 'git_url is required');
	}

	const slug = slugify(name);
	if (!slug) {
		return jsonError(400, 'name must contain at least one alphanumeric character');
	}

	/* Check for duplicate slug */
	const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
	if (existing.length > 0) {
		return jsonError(409, `A project with slug "${slug}" already exists`);
	}

	const port = await allocatePort();
	const webhookSecret = generateWebhookSecret();

	const [project] = await db
		.insert(projects)
		.values({
			name: name.trim(),
			slug,
			repoUrl: git_url.trim(),
			branch: typeof branch === 'string' && branch.trim() ? branch.trim() : 'main',
			frameworkId: typeof framework_id === 'string' ? framework_id : undefined,
			port,
			webhookSecret
		})
		.returning();

	return json(project, { status: 201 });
};
