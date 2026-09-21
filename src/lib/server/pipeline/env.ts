import { db } from '$lib/server/db'
import { projects, envVars } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt, safeDecrypt } from '$lib/server/crypto'
import {
	buildManagedPostgresEnv,
	generatePostgresPassword,
	managedPostgresConfig,
	type ManagedPostgresConfig
} from './postgres'

/**
 * Load and decrypt the project's current env vars.
 */
export async function loadProjectEnv(projectId: string): Promise<Record<string, string>> {
	const rows = await db
		.select({ key: envVars.key, value: envVars.value })
		.from(envVars)
		.where(eq(envVars.projectId, projectId))

	const envMap: Record<string, string> = {}
	for (const row of rows) {
		envMap[row.key] = safeDecrypt(row.value)
	}
	return envMap
}

/**
 * Resolve the managed Postgres config, password, and the env vars exposed to the app.
 * Generates and stores a password if the project doesn't have one yet.
 */
export async function resolveManagedPostgresEnv(
	projectId: string,
	storedPassword: string | null | undefined
): Promise<{ postgres: ManagedPostgresConfig; password: string; env: Record<string, string> }> {
	const postgres = managedPostgresConfig(projectId)
	const password = await resolveManagedPostgresPassword(projectId, storedPassword)
	return { postgres, password, env: buildManagedPostgresEnv(postgres, password) }
}

async function resolveManagedPostgresPassword(
	projectId: string,
	storedPassword: string | null | undefined
): Promise<string> {
	const existing = storedPassword ? safeDecrypt(storedPassword) : null
	if (existing) return existing

	const password = generatePostgresPassword()
	const encryptedPassword = encrypt(password)
	await db
		.update(projects)
		.set({ postgresPassword: encryptedPassword, updatedAt: new Date().toISOString() })
		.where(eq(projects.id, projectId))

	return password
}
