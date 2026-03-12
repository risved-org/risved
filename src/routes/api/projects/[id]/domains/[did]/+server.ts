import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { domains } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { CaddyClient } from '$lib/server/caddy';
import type { RequestHandler } from './$types';

/**
 * DELETE /api/projects/:id/domains/:did — remove a domain.
 */
export const DELETE: RequestHandler = async (event) => {
	requireAuth(event);

	const { id, did } = event.params;

	const rows = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, did), eq(domains.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Domain not found');
	}

	const domain = rows[0];

	/* Remove Caddy route (best-effort) */
	try {
		const caddy = new CaddyClient();
		await caddy.removeRoute(domain.hostname);
	} catch {
		/* Caddy may not be running — ignore */
	}

	await db.delete(domains).where(eq(domains.id, did));

	return json({ success: true });
};
