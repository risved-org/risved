import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { verifyForgejoToken } from '$lib/server/forgejo';
import type { RequestHandler } from './$types';

/**
 * GET /api/git/forgejo — list Forgejo/Gitea connections.
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections)
		.where(eq(gitConnections.provider, 'forgejo'));

	return json(connections);
};

/**
 * POST /api/git/forgejo — connect a Forgejo/Gitea instance with API token.
 * Body: { instanceUrl, token }
 */
export const POST: RequestHandler = async (event) => {
	requireAuth(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { instanceUrl, token } = body as Record<string, string>;
	if (!instanceUrl || !token) {
		return jsonError(400, 'instanceUrl and token are required');
	}

	/* Verify token by fetching user info */
	let user;
	try {
		user = await verifyForgejoToken(instanceUrl, token);
	} catch {
		return jsonError(401, 'Invalid token or instance URL');
	}

	/* Upsert connection */
	const existing = await db
		.select()
		.from(gitConnections)
		.where(and(eq(gitConnections.provider, 'forgejo'), eq(gitConnections.accountName, user.login)))
		.limit(1);

	if (existing.length > 0) {
		await db
			.update(gitConnections)
			.set({
				accessToken: token,
				avatarUrl: user.avatar_url,
				updatedAt: new Date().toISOString()
			})
			.where(eq(gitConnections.id, existing[0].id));
	} else {
		await db.insert(gitConnections).values({
			provider: 'forgejo',
			accountName: user.login,
			accessToken: token,
			avatarUrl: user.avatar_url
		});
	}

	return json({ success: true, accountName: user.login });
};

/**
 * DELETE /api/git/forgejo — disconnect a Forgejo/Gitea connection.
 * Body: { connectionId }
 */
export const DELETE: RequestHandler = async (event) => {
	requireAuth(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { connectionId } = body as Record<string, unknown>;
	if (!connectionId || typeof connectionId !== 'string') {
		return jsonError(400, 'connectionId is required');
	}

	await db.delete(gitConnections).where(eq(gitConnections.id, connectionId));

	return json({ success: true });
};
