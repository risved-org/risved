import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { GitHubClient } from '$lib/server/github';
import type { RequestHandler } from './$types';

/**
 * GET /api/git/github/repos — list repos for a GitHub connection.
 * Query params: connectionId, page (default 1), search (optional)
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const connectionId = event.url.searchParams.get('connectionId');
	if (!connectionId) {
		return jsonError(400, 'connectionId is required');
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
	const client = new GitHubClient(connection.accessToken);

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
