/**
 * API keys for headless clients.
 *
 * A key is shown once, at creation, and stored only as a SHA-256 digest — a
 * database dump yields nothing usable. Verification is a single indexed lookup
 * on that digest.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '$lib/server/db';
import { apiKeys } from '$lib/server/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';

const PREFIX = 'rsv_';
/** 32 bytes of entropy, base64url — 43 characters after the prefix. */
const KEY_BYTES = 32;

export interface ApiKeyRecord {
	id: string;
	userId: string;
	label: string;
	keyPrefix: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
	createdAt: string;
}

function hashKey(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
function digestsMatch(a: string, b: string): boolean {
	const left = Buffer.from(a, 'hex');
	const right = Buffer.from(b, 'hex');
	if (left.length !== right.length || left.length === 0) return false;
	return timingSafeEqual(left, right);
}

/**
 * Mint a key for a user. The plaintext is returned exactly once — the caller
 * must show it and then forget it.
 */
export async function createApiKey(
	userId: string,
	label: string
): Promise<{ key: string; record: ApiKeyRecord }> {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('label is required');

	const key = PREFIX + randomBytes(KEY_BYTES).toString('base64url');

	const [row] = await db
		.insert(apiKeys)
		.values({
			userId,
			label: trimmed,
			keyHash: hashKey(key),
			keyPrefix: key.slice(0, PREFIX.length + 6)
		})
		.returning();

	return { key, record: toRecord(row) };
}

/**
 * Resolve a bearer key to the user it belongs to, or null.
 *
 * Revoked keys resolve to null. `lastUsedAt` is refreshed in the background so
 * a slow write never delays the request.
 */
export async function verifyApiKey(key: string): Promise<{ userId: string; id: string } | null> {
	if (!key.startsWith(PREFIX)) return null;

	const digest = hashKey(key);
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, digest)).limit(1);

	const row = rows[0];
	if (!row || row.revokedAt) return null;
	if (!digestsMatch(row.keyHash, digest)) return null;

	db.update(apiKeys)
		.set({ lastUsedAt: new Date().toISOString() })
		.where(eq(apiKeys.id, row.id))
		.catch(() => {});

	return { userId: row.userId, id: row.id };
}

/** A user's live keys, newest first. Never returns key material. */
export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
	const rows = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
		.orderBy(desc(apiKeys.createdAt));

	return rows.map(toRecord);
}

/**
 * Revoke a key. Scoped to the owning user, so an id from elsewhere is a no-op
 * rather than a way to disable someone else's key. Returns whether it hit.
 */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
	const revoked = await db
		.update(apiKeys)
		.set({ revokedAt: new Date().toISOString() })
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
		.returning({ id: apiKeys.id });

	return revoked.length > 0;
}

function toRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
	return {
		id: row.id,
		userId: row.userId,
		label: row.label,
		keyPrefix: row.keyPrefix,
		lastUsedAt: row.lastUsedAt,
		revokedAt: row.revokedAt,
		createdAt: row.createdAt
	};
}
