import { json } from '@sveltejs/kit';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { rollbackProject, ServiceError } from '$lib/server/projects';
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
 * POST /api/projects/:id/deployments/:did/rollback — roll back to this deployment.
 * Re-deploys the cached Docker image without rebuilding.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, did } = event.params;

	try {
		const result = await rollbackProject(id, did);
		return json({ success: true, deploymentId: result.deploymentId });
	} catch (err) {
		if (err instanceof ServiceError) {
			const status = STATUS[err.code] ?? 500;
			if (err.code === 'internal') {
				return json(
					{ success: false, deploymentId: err.data.deploymentId, error: err.message },
					{ status }
				);
			}
			return jsonError(status, err.message);
		}
		throw err;
	}
};
