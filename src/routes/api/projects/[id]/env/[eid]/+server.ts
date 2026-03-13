import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { envVars } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { encrypt, safeDecrypt } from '$lib/server/crypto';
import type { RequestHandler } from './$types';

/** Mask a secret value, showing only the first 4 chars of the decrypted value. */
function maskValue(value: string, isSecret: boolean): string {
	if (!isSecret) return safeDecrypt(value);
	const plain = safeDecrypt(value);
	if (plain.length <= 4) return '••••';
	return plain.slice(0, 4) + '••••••••';
}

/**
 * PUT /api/projects/:id/env/:eid — update an environment variable.
 * Body: { value?, is_secret? }
 */
export const PUT: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, eid } = event.params;

	const rows = await db
		.select()
		.from(envVars)
		.where(and(eq(envVars.id, eid), eq(envVars.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Environment variable not found');
	}

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { value, is_secret } = body as Record<string, unknown>;

	const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	if (value !== undefined) {
		if (typeof value !== 'string') {
			return jsonError(400, 'value must be a string');
		}
		updates.value = encrypt(value);
	}
	if (is_secret !== undefined) {
		updates.isSecret = is_secret === true;
	}

	const [updated] = await db.update(envVars).set(updates).where(eq(envVars.id, eid)).returning();

	return json({
		...updated,
		value: maskValue(updated.value, updated.isSecret)
	});
};

/**
 * DELETE /api/projects/:id/env/:eid — delete an environment variable.
 */
export const DELETE: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, eid } = event.params;

	const rows = await db
		.select()
		.from(envVars)
		.where(and(eq(envVars.id, eid), eq(envVars.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Environment variable not found');
	}

	await db.delete(envVars).where(eq(envVars.id, eid));

	return json({ success: true });
};
