import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { safeDecrypt } from '$lib/server/crypto'

/**
 * Look up a git connection and return the decrypted access token.
 * Returns null if the connection doesn't exist.
 */
export async function resolveCloneToken(connectionId: string): Promise<string | null> {
	const [conn] = await db
		.select({ accessToken: gitConnections.accessToken, provider: gitConnections.provider })
		.from(gitConnections)
		.where(eq(gitConnections.id, connectionId))
		.limit(1)

	if (!conn) return null
	return safeDecrypt(conn.accessToken)
}
