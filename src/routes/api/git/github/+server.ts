import { json, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { getGitHubAuthUrl, exchangeGitHubCode, GitHubClient } from '$lib/server/github';
import type { RequestHandler } from './$types';

/**
 * GET /api/git/github — list GitHub connections or initiate OAuth.
 * ?action=connect → redirect to GitHub OAuth
 * ?action=callback&code=...&state=... → handle OAuth callback
 * default → list connections
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const action = event.url.searchParams.get('action');

	if (action === 'connect') {
		const clientId = env.GITHUB_CLIENT_ID;
		if (!clientId) {
			return jsonError(500, 'GitHub OAuth not configured (missing GITHUB_CLIENT_ID)');
		}

		const state = crypto.randomUUID();
		event.cookies.set('github_oauth_state', state, {
			path: '/',
			httpOnly: true,
			secure: false,
			maxAge: 600
		});

		const redirectUri = `${event.url.origin}/api/git/github?action=callback`;
		const authUrl = getGitHubAuthUrl(clientId, redirectUri, state);

		redirect(302, authUrl);
	}

	if (action === 'callback') {
		const code = event.url.searchParams.get('code');
		const state = event.url.searchParams.get('state');
		const savedState = event.cookies.get('github_oauth_state');

		event.cookies.delete('github_oauth_state', { path: '/' });

		if (!code || !state || state !== savedState) {
			return jsonError(400, 'Invalid OAuth callback: missing or mismatched state');
		}

		const clientId = env.GITHUB_CLIENT_ID;
		const clientSecret = env.GITHUB_CLIENT_SECRET;
		if (!clientId || !clientSecret) {
			return jsonError(500, 'GitHub OAuth not configured');
		}

		const tokenData = await exchangeGitHubCode(clientId, clientSecret, code);
		const client = new GitHubClient(tokenData.access_token);
		const ghUser = await client.getUser();

		/* Upsert connection */
		const existing = await db
			.select()
			.from(gitConnections)
			.where(eq(gitConnections.accountName, ghUser.login))
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(gitConnections)
				.set({
					accessToken: tokenData.access_token,
					avatarUrl: ghUser.avatar_url,
					updatedAt: new Date().toISOString()
				})
				.where(eq(gitConnections.id, existing[0].id));
		} else {
			await db.insert(gitConnections).values({
				provider: 'github',
				accountName: ghUser.login,
				accessToken: tokenData.access_token,
				avatarUrl: ghUser.avatar_url
			});
		}

		redirect(302, '/settings');
	}

	/* Default: list GitHub connections */
	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections)
		.where(eq(gitConnections.provider, 'github'));

	return json(connections);
};

/**
 * DELETE /api/git/github — disconnect a GitHub connection.
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
