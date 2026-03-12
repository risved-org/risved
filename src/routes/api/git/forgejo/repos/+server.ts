import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { ForgejoClient } from '$lib/server/forgejo';
import type { RequestHandler } from './$types';

/**
 * GET /api/git/forgejo/repos — list repos for a Forgejo/Gitea connection.
 * Query params: connectionId, instanceUrl, page (default 1), search (optional)
 */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const connectionId = event.url.searchParams.get('connectionId');
	const instanceUrl = event.url.searchParams.get('instanceUrl');
	if (!connectionId) {
		return jsonError(400, 'connectionId is required');
	}
	if (!instanceUrl) {
		return jsonError(400, 'instanceUrl is required');
	}

	const rows = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.id, connectionId))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Connection not found');
	}

	const connection = rows[0];
	const client = new ForgejoClient(connection.accessToken, instanceUrl);

	const search = event.url.searchParams.get('search');
	const page = parseInt(event.url.searchParams.get('page') ?? '1', 10);

	let repos;
	if (search && search.trim()) {
		repos = await client.searchRepos(search.trim());
	} else {
		repos = await client.listRepos(page);
	}

	return json(
		repos.map((r) => ({
			id: r.id,
			fullName: r.full_name,
			name: r.name,
			owner: r.owner.login,
			private: r.private,
			defaultBranch: r.default_branch,
			htmlUrl: r.html_url,
			cloneUrl: r.clone_url,
			description: r.description,
			language: r.language,
			updatedAt: r.updated_at
		}))
	);
};
