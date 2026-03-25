import { json } from '@sveltejs/kit';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { getSetting, setSetting } from '$lib/server/settings';
import { getCleanupManager } from '$lib/server/cleanup';
import type { RequestHandler } from './$types';

/**
 * GET /api/cleanup
 * Returns log retention setting and Docker disk usage.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const manager = getCleanupManager();
	const retentionDays = await getSetting('log_retention_days');
	const diskUsage = await manager.getDockerDiskUsage();

	return json({
		retentionDays: retentionDays ? parseInt(retentionDays, 10) : 30,
		diskUsage
	});
};

/**
 * POST /api/cleanup
 * Actions: updateRetention, runCleanup, dockerPrune
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const body = await event.request.json();
	const { action } = body;

	if (action === 'updateRetention') {
		const days = parseInt(body.days, 10);
		if (isNaN(days) || days < 1 || days > 365) {
			return jsonError(400, 'Retention days must be between 1 and 365');
		}
		await setSetting('log_retention_days', String(days));
		return json({ success: true, retentionDays: days });
	}

	if (action === 'runCleanup') {
		const manager = getCleanupManager();
		const result = await manager.runCleanup();
		return json({ success: true, result });
	}

	if (action === 'dockerPrune') {
		const type = body.type;
		if (!['images', 'containers', 'volumes', 'buildcache', 'all'].includes(type)) {
			return jsonError(400, 'Invalid prune type');
		}
		const manager = getCleanupManager();
		const result = await manager.dockerPrune(type);
		return json({ success: true, result });
	}

	return jsonError(400, 'Unknown action');
};
