import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyForgejoToken } from '$lib/server/forgejo';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { connections: [] };
	}

	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections);

	return { connections };
};

export const actions: Actions = {
	/** Connect a Forgejo/Gitea instance with API token. */
	forgejo: async ({ request }) => {
		const formData = await request.formData();
		const instanceUrl = (formData.get('instanceUrl') as string)?.trim();
		const token = (formData.get('token') as string)?.trim();

		if (!instanceUrl) {
			return fail(400, { forgejoError: 'Instance URL is required' });
		}
		if (!token) {
			return fail(400, { forgejoError: 'API token is required' });
		}

		try {
			new URL(instanceUrl);
		} catch {
			return fail(400, { forgejoError: 'Invalid URL format' });
		}

		let user;
		try {
			user = await verifyForgejoToken(instanceUrl, token);
		} catch {
			return fail(400, { forgejoError: 'Could not connect — check URL and token' });
		}

		const existing = await db
			.select()
			.from(gitConnections)
			.where(eq(gitConnections.accountName, user.login))
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

		return { forgejoConnected: true, accountName: user.login };
	},

	/** Disconnect a provider connection. */
	disconnect: async ({ request }) => {
		const formData = await request.formData();
		const connectionId = formData.get('connectionId') as string;

		if (!connectionId) {
			return fail(400, { disconnectError: 'Connection ID required' });
		}

		await db.delete(gitConnections).where(eq(gitConnections.id, connectionId));

		return { disconnected: true };
	}
};
