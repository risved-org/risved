import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { gitConnections, projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { GitLabClient } from '$lib/server/gitlab';
import { safeDecrypt } from '$lib/server/crypto';
import { getSetting } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * POST /api/git/gitlab/webhook — auto-configure webhook on a GitLab project.
 * Body: { connectionId, projectId, gitlabProjectId }
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { connectionId, projectId, gitlabProjectId } = body as Record<string, unknown>;

	if (!connectionId || !projectId || !gitlabProjectId) {
		return jsonError(400, 'connectionId, projectId, and gitlabProjectId are required');
	}

	const connRows = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.id, connectionId as string))
		.limit(1);
	if (connRows.length === 0) {
		return jsonError(404, 'Connection not found');
	}

	const projRows = await db
		.select()
		.from(projects)
		.where(eq(projects.id, projectId as string))
		.limit(1);
	if (projRows.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const project = projRows[0];
	if (!project.webhookSecret) {
		return jsonError(400, 'Project has no webhook secret configured');
	}

	const instanceUrl = env.GITLAB_INSTANCE_URL || 'https://gitlab.com';
	const hostname = await getSetting('hostname')
	const origin = hostname ? `https://${hostname}` : event.url.origin
	const webhookUrl = `${origin}/api/webhooks/${projectId}`;
	const client = new GitLabClient(safeDecrypt(connRows[0].accessToken), instanceUrl);

	const result = await client.createWebhook({
		projectId: gitlabProjectId as number,
		webhookUrl,
		secret: project.webhookSecret,
		pushEvents: true,
		mergeRequestsEvents: true
	});

	return json({ success: true, webhookId: result.id });
};
