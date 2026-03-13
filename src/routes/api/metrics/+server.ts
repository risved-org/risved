import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api-utils';
import { getServerMetrics } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

/** GET /api/metrics?hours=24 — returns server-wide aggregated resource metrics */
export const GET: RequestHandler = async (event) => {
	requireAuth(event);

	const hours = Math.min(parseInt(event.url.searchParams.get('hours') ?? '24', 10) || 24, 168);
	const metrics = await getServerMetrics(hours);
	return json({ metrics });
};
