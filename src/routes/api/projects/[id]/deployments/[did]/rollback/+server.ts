import { requireAuth, jsonError } from '$lib/server/api-utils';
import type { RequestHandler } from './$types';

/**
 * POST /api/projects/:id/deployments/:did/rollback — rollback to this deployment.
 * Stub for Phase 1 — returns 501 Not Implemented.
 */
export const POST: RequestHandler = async (event) => {
	requireAuth(event);
	return jsonError(501, 'Rollback is not yet implemented (Phase 2)');
};
