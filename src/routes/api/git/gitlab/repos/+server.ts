import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { GitLabClient } from '$lib/server/gitlab';
import type { RequestHandler } from './$types';

/**
 * GET /api/git/gitlab/repos — list repos for a GitLab connection.
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
	const instanceUrl = env.GITLAB_INSTANCE_URL || 'https://gitlab.com';
	const client = new GitLabClient(connection.accessToken, instanceUrl);

	const search = event.url.searchParams.get('search');
	const page = parseInt(event.url.searchParams.get('page') ?? '1', 10);

	let projects;
	if (search && search.trim()) {
		projects = await client.searchProjects(search.trim());
	} else {
		projects = await client.listProjects(page);
	}

	return json(
		projects.map((p) => ({
			id: p.id,
			fullName: p.path_with_namespace,
			name: p.name,
			owner: p.namespace.full_path,
			private: p.visibility === 'private',
			defaultBranch: p.default_branch,
			htmlUrl: p.web_url,
			cloneUrl: p.http_url_to_repo,
			description: p.description,
			language: null,
			updatedAt: p.last_activity_at
		}))
	);
};
