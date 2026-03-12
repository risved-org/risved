import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections, projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { GitHubClient } from '$lib/server/github';
import type { RequestHandler } from './$types';

/**
 * POST /api/git/github/webhook — auto-configure webhook on a GitHub repo.
 * Body: { connectionId, projectId, owner, repo }
 */
export const POST: RequestHandler = async (event) => {
	requireAuth(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { connectionId, projectId, owner, repo } = body as Record<string, string>;

	if (!connectionId || !projectId || !owner || !repo) {
		return jsonError(400, 'connectionId, projectId, owner, and repo are required');
	}

	const connRows = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.id, connectionId))
		.limit(1);
	if (connRows.length === 0) {
		return jsonError(404, 'Connection not found');
	}

	const projRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
	if (projRows.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const project = projRows[0];
	if (!project.webhookSecret) {
		return jsonError(400, 'Project has no webhook secret configured');
	}

	const webhookUrl = `${event.url.origin}/api/webhooks/${projectId}`;
	const client = new GitHubClient(connRows[0].accessToken);

	const result = await client.createWebhook({
		owner,
		repo,
		webhookUrl,
		secret: project.webhookSecret,
		events: ['push', 'pull_request']
	});

	return json({ success: true, webhookId: result.id });
};
