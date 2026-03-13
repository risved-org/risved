import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, envVars } from '$lib/server/db/schema';
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
 * GET /api/projects/:id/env — list environment variables (secrets masked).
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id } = event.params;

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
	if (proj.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const rows = await db.select().from(envVars).where(eq(envVars.projectId, id));

	const masked = rows.map((row) => ({
		...row,
		value: maskValue(row.value, row.isSecret)
	}));

	return json(masked);
};

/**
 * POST /api/projects/:id/env — add an environment variable.
 * Body: { key, value, is_secret? }
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id } = event.params;

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
	if (proj.length === 0) {
		return jsonError(404, 'Project not found');
	}

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body');
	}

	const { key, value, is_secret } = body as Record<string, unknown>;

	if (!key || typeof key !== 'string' || key.trim().length === 0) {
		return jsonError(400, 'key is required');
	}
	if (value === undefined || value === null || typeof value !== 'string') {
		return jsonError(400, 'value is required and must be a string');
	}

	/* Validate key format: uppercase letters, digits, underscores */
	const trimmedKey = key.trim();
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedKey)) {
		return jsonError(400, 'key must contain only letters, digits, and underscores');
	}

	/* Check for duplicate key */
	const existing = await db
		.select()
		.from(envVars)
		.where(and(eq(envVars.projectId, id), eq(envVars.key, trimmedKey)))
		.limit(1);

	if (existing.length > 0) {
		return jsonError(409, `Environment variable "${trimmedKey}" already exists`);
	}

	const isSecret = is_secret === true;
	const encryptedValue = encrypt(value);

	const [created] = await db
		.insert(envVars)
		.values({
			projectId: id,
			key: trimmedKey,
			value: encryptedValue,
			isSecret
		})
		.returning();

	return json(
		{
			...created,
			value: maskValue(created.value, created.isSecret)
		},
		{ status: 201 }
	);
};
