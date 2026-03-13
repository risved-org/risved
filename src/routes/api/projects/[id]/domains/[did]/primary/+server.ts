import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { domains } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import type { RequestHandler } from './$types';

/**
 * POST /api/projects/:id/domains/:did/primary — set as primary domain.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, did } = event.params;

	const rows = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, did), eq(domains.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Domain not found');
	}

	/* Unset all other domains as non-primary for this project */
	await db
		.update(domains)
		.set({ isPrimary: false })
		.where(eq(domains.projectId, id));

	/* Set the selected domain as primary */
	const [updated] = await db
		.update(domains)
		.set({ isPrimary: true })
		.where(eq(domains.id, did))
		.returning();

	return json(updated);
};
