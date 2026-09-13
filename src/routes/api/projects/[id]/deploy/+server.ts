import { json } from '@sveltejs/kit';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { deployProject, ServiceError } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/** Map a service error onto the status codes this API already returns. */
const STATUS: Record<string, number> = {
	not_found: 404,
	validation: 400,
	forbidden: 403,
	deploy_in_progress: 409,
	github_app_not_installed: 400,
	internal: 500
};

/**
 * POST /api/projects/:id/deploy — trigger a manual deployment.
 *
 * `allowConcurrent` keeps the dashboard's behaviour: pressing Deploy while a
 * build runs queues another rather than refusing. The MCP `deploy` tool does
 * not, so an agent polling a slow build cannot stack them up.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id } = event.params;

	try {
		const result = await deployProject(id, { allowConcurrent: true });
		return json({ success: true, deploymentId: result.deploymentId });
	} catch (err) {
		if (err instanceof ServiceError) {
			return jsonError(STATUS[err.code] ?? 500, err.message);
		}
		throw err;
	}
};
