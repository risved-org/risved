import { json, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { getGitLabAuthUrl, exchangeGitLabCode, GitLabClient } from '$lib/server/gitlab';
import type { RequestHandler } from './$types';

/**
 * GET /api/git/gitlab — list GitLab connections or initiate OAuth.
 * ?action=connect → redirect to GitLab OAuth
 * ?action=callback&code=...&state=... → handle OAuth callback
 * default → list connections
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const action = event.url.searchParams.get('action');

	if (action === 'connect') {
		const clientId = env.GITLAB_CLIENT_ID;
		const instanceUrl = env.GITLAB_INSTANCE_URL || 'https://gitlab.com';
		if (!clientId) {
			return jsonError(500, 'GitLab OAuth not configured (missing GITLAB_CLIENT_ID)');
		}

		const state = crypto.randomUUID();
		event.cookies.set('gitlab_oauth_state', state, {
			path: '/',
			httpOnly: true,
			secure: false,
			maxAge: 600
		});

		const redirectUri = `${event.url.origin}/api/git/gitlab?action=callback`;
		const authUrl = getGitLabAuthUrl(clientId, redirectUri, state, instanceUrl);

		redirect(302, authUrl);
	}

	if (action === 'callback') {
		const code = event.url.searchParams.get('code');
		const state = event.url.searchParams.get('state');
		const savedState = event.cookies.get('gitlab_oauth_state');

		event.cookies.delete('gitlab_oauth_state', { path: '/' });

		if (!code || !state || state !== savedState) {
			return jsonError(400, 'Invalid OAuth callback: missing or mismatched state');
		}

		const clientId = env.GITLAB_CLIENT_ID;
		const clientSecret = env.GITLAB_CLIENT_SECRET;
		const instanceUrl = env.GITLAB_INSTANCE_URL || 'https://gitlab.com';
		if (!clientId || !clientSecret) {
			return jsonError(500, 'GitLab OAuth not configured');
		}

		const redirectUri = `${event.url.origin}/api/git/gitlab?action=callback`;
		const tokenData = await exchangeGitLabCode(
			clientId,
			clientSecret,
			code,
			redirectUri,
			instanceUrl
		);

		const client = new GitLabClient(tokenData.access_token, instanceUrl);
		const glUser = await client.getUser();

		/* Upsert connection */
		const existing = await db
			.select()
			.from(gitConnections)
			.where(
				and(eq(gitConnections.provider, 'gitlab'), eq(gitConnections.accountName, glUser.username))
			)
			.limit(1);

		const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

		if (existing.length > 0) {
			await db
				.update(gitConnections)
				.set({
					accessToken: tokenData.access_token,
					refreshToken: tokenData.refresh_token,
					tokenExpiresAt: expiresAt,
					avatarUrl: glUser.avatar_url,
					updatedAt: new Date().toISOString()
				})
				.where(eq(gitConnections.id, existing[0].id));
		} else {
			await db.insert(gitConnections).values({
				provider: 'gitlab',
				accountName: glUser.username,
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token,
				tokenExpiresAt: expiresAt,
				avatarUrl: glUser.avatar_url
			});
		}

		redirect(302, '/settings');
	}

	/* Default: list GitLab connections */
	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections)
		.where(eq(gitConnections.provider, 'gitlab'));

	return json(connections);
};

/**
 * DELETE /api/git/gitlab — disconnect a GitLab connection.
 * Body: { connectionId }
 */
export const DELETE: RequestHandler = async (event) => {
	await requireAuth(event);

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
