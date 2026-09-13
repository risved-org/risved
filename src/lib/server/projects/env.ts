import { encrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { envVars } from '$lib/server/db/schema'
import { and, asc, eq } from 'drizzle-orm'

import { requireProject } from './read'
import { ServiceError } from './types'
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface SetEnvResult {
	names: string[]
	removed: string[]
	requiresRedeploy: boolean
}

/**
 * Upsert and remove environment variables in one call.
 *
 * Does not redeploy: env vars are read at container start, so the caller
 * decides when the change lands. Returns names only.
 */
export async function setProjectEnv(
	projectId: string,
	vars: Record<string, string>,
	remove: string[] = []
): Promise<SetEnvResult> {
	const project = await requireProject(projectId)

	const entries = Object.entries(vars ?? {})
	const invalid = entries
		.map(([key]) => key)
		.concat(remove ?? [])
		.filter((key) => !ENV_KEY_PATTERN.test(key))

	if (invalid.length > 0) {
		throw new ServiceError(
			'validation',
			`Invalid environment variable name(s): ${invalid.join(', ')} — letters, digits and underscores only, not starting with a digit`
		)
	}

	const now = new Date().toISOString()

	for (const [key, value] of entries) {
		await db
			.insert(envVars)
			.values({
				projectId: project.id,
				key,
				value: encrypt(String(value)),
				/* Set over the API without a UI to reveal them — treat as secret. */
				isSecret: true
			})
			.onConflictDoUpdate({
				target: [envVars.projectId, envVars.key],
				set: { value: encrypt(String(value)), isSecret: true, updatedAt: now }
			})
	}

	for (const key of remove ?? []) {
		await db.delete(envVars).where(and(eq(envVars.projectId, project.id), eq(envVars.key, key)))
	}

	const remaining = await db
		.select({ key: envVars.key })
		.from(envVars)
		.where(eq(envVars.projectId, project.id))
		.orderBy(asc(envVars.key))

	return {
		names: remaining.map((r) => r.key),
		removed: remove ?? [],
		requiresRedeploy: true
	}
}
