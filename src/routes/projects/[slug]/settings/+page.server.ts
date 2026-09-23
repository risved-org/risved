import { error, fail, redirect } from '@sveltejs/kit'
import { createCommandRunner, dockerStop, dockerVolumeRemove, projectVolumeName } from '$lib/server/pipeline/docker'
import {
	buildManagedPostgresEnv,
	ensureManagedPostgres,
	generatePostgresPassword,
	managedPostgresConfig,
	managedPostgresContainerName,
	managedPostgresVolumeName
} from '$lib/server/pipeline/postgres'
import { db } from '$lib/server/db'
import {
	projects,
	deployments,
	domains,
	envVars,
	webhookDeliveries,
	cronJobs,
	cronRuns
} from '$lib/server/db/schema'
import { eq, desc } from 'drizzle-orm'
import { encrypt, safeDecrypt } from '$lib/server/crypto'
import { getCronScheduler } from '$lib/server/cron'
import type { PageServerLoad, Actions } from './$types'

export const load = (async ({ params }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	const project = proj[0]

	/* Env vars (masked for display, decrypted for editing) */
	const envs = await db.select().from(envVars).where(eq(envVars.projectId, project.id))

	/* Domains */
	const doms = await db.select().from(domains).where(eq(domains.projectId, project.id))

	/* Cron jobs with latest run */
	const crons = await db.select().from(cronJobs).where(eq(cronJobs.projectId, project.id))
	const cronJobsWithLastRun = await Promise.all(
		crons.map(async (job) => {
			const lastRun = await db
				.select()
				.from(cronRuns)
				.where(eq(cronRuns.cronJobId, job.id))
				.orderBy(desc(cronRuns.startedAt))
				.limit(1)
			return {
				id: job.id,
				name: job.name,
				route: job.route,
				method: job.method,
				schedule: job.schedule,
				timezone: job.timezone,
				enabled: job.enabled,
				lastRun: lastRun[0]
					? {
							status: lastRun[0].status,
							statusCode: lastRun[0].statusCode,
							startedAt: lastRun[0].startedAt,
							durationMs: lastRun[0].durationMs
						}
					: null
			}
		})
	)

	/* Webhook status */
	const lastDelivery = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.projectId, project.id))
		.orderBy(desc(webhookDeliveries.createdAt))
		.limit(1)

	return {
		settings: {
			buildCommand: project.buildCommand ?? '',
			startCommand: project.startCommand ?? '',
			releaseCommand: project.releaseCommand ?? ''
		},
		postgres: project.postgresEnabled
			? {
					createdAt: project.postgresCreatedAt,
					...buildPostgresMetadata(project.id, project.postgresPassword)
				}
			: null,
		/* Secrets are write-only: their stored value never leaves the server */
		envVars: envs.map((e) => ({
			id: e.id,
			key: e.key,
			value: e.isSecret ? '' : safeDecrypt(e.value),
			isSecret: e.isSecret
		})),
		domains: doms.map((d) => ({
			id: d.id,
			hostname: d.hostname,
			isPrimary: d.isPrimary,
			sslStatus: d.sslStatus
		})),
		cronJobs: cronJobsWithLastRun,
		webhookActive: !!project.webhookSecret,
		lastWebhookAt: lastDelivery[0]?.createdAt ?? null
	}
}) satisfies PageServerLoad

export const actions: Actions = {
	saveScripts: async ({ params, request }) => {
		const { slug } = params
		const formData = await request.formData()
		const buildCommand = (formData.get('buildCommand') as string)?.trim() || null
		const startCommand = (formData.get('startCommand') as string)?.trim() || null
		const releaseCommand = (formData.get('releaseCommand') as string)?.trim() || null

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { error: 'Project not found' })

		await db
			.update(projects)
			.set({ buildCommand, startCommand, releaseCommand, updatedAt: new Date().toISOString() })
			.where(eq(projects.id, proj[0].id))

		return { scriptsSaved: true }
	},

	saveEnv: async ({ params, request }) => {
		const { slug } = params
		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { error: 'Project not found' })

		const projectId = proj[0].id
		const formData = await request.formData()

		const envIdsRaw = formData.get('envIds') as string | null
		const envKeysRaw = formData.get('envKeys') as string | null
		const envValsRaw = formData.get('envValues') as string | null
		const envSecretsRaw = formData.get('envSecrets') as string | null
		const envKeepRaw = formData.get('envKeep') as string | null

		const envIds = envIdsRaw ? envIdsRaw.split('\x1F') : []
		const envKeys = envKeysRaw ? envKeysRaw.split('\x1F') : []
		const envValues = envValsRaw ? envValsRaw.split('\x1F') : []
		const envSecrets = envSecretsRaw ? envSecretsRaw.split('\x1F') : []
		const envKeep = envKeepRaw ? envKeepRaw.split('\x1F') : []

		const existing = await db.select().from(envVars).where(eq(envVars.projectId, projectId))
		const existingById = new Map(existing.map((e) => [e.id, e]))

		const rows: { id?: string; projectId: string; key: string; value: string; isSecret: boolean }[] = []
		const seenKeys = new Set<string>()

		for (let i = 0; i < envKeys.length; i++) {
			const key = envKeys[i]?.trim()
			if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
			if (seenKeys.has(key)) return fail(400, { error: `"${key}" is defined more than once` })
			seenKeys.add(key)

			const isSecret = envSecrets[i] === '1'
			const stored = envIds[i] ? existingById.get(envIds[i]) : undefined
			let value: string

			/* The editor unlocks a row when Secret is unticked, so this must not
			   depend on envKeep: without a replacement the empty value would
			   otherwise overwrite the stored ciphertext for good. */
			if (stored?.isSecret && !isSecret && !envValues[i]) {
				return fail(400, { error: `Enter a new value to make "${key}" a plain variable` })
			}

			if (envKeep[i] === '1') {
				/* The browser never holds a stored secret, so an untouched row
				   carries its ciphertext over instead of submitting a value. */
				if (!stored?.isSecret) return fail(400, { error: `Enter a value for "${key}"` })
				if (!isSecret) {
					return fail(400, { error: `Enter a new value to make "${key}" a plain variable` })
				}
				value = stored.value
			} else {
				value = encrypt(envValues[i] ?? '')
			}

			rows.push({ id: stored?.id, projectId, key, value, isSecret })
		}

		/* Kept secrets only exist in the database, so replace the set atomically */
		await db.transaction(async (tx) => {
			await tx.delete(envVars).where(eq(envVars.projectId, projectId))
			for (const row of rows) {
				await tx.insert(envVars).values(row)
			}
		})

		return { envSaved: true }
	},

	addPostgres: async ({ params }) => {
		const { slug } = params
		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { postgresError: 'Project not found' })

		const project = proj[0]
		const config = managedPostgresConfig(project.id)
		const password = project.postgresPassword
			? safeDecrypt(project.postgresPassword)
			: generatePostgresPassword()

		const result = await ensureManagedPostgres(createCommandRunner(), config, password)
		if (!result.success) {
			return fail(500, { postgresError: result.error ?? 'Failed to create Postgres database' })
		}

		await db
			.update(projects)
			.set({
				postgresEnabled: true,
				postgresPassword: encrypt(password),
				postgresCreatedAt: project.postgresCreatedAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
			.where(eq(projects.id, project.id))

		return { postgresAdded: true }
	},

	removePostgres: async ({ params }) => {
		const { slug } = params
		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { postgresError: 'Project not found' })

		const project = proj[0]
		const runner = createCommandRunner()
		try { await dockerStop(runner, managedPostgresContainerName(project.id), 10) } catch { /* best-effort */ }
		try { await dockerVolumeRemove(runner, managedPostgresVolumeName(project.id)) } catch { /* best-effort */ }

		await db
			.update(projects)
			.set({
				postgresEnabled: false,
				postgresPassword: null,
				postgresCreatedAt: null,
				updatedAt: new Date().toISOString()
			})
			.where(eq(projects.id, project.id))

		return { postgresRemoved: true }
	},

	delete: async ({ params }) => {
		const { slug } = params

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { error: 'Project not found' })

		const projectId = proj[0].id

		const runner = createCommandRunner()
		try { await dockerStop(runner, proj[0].slug, 10) } catch { /* may not be running */ }
		try { await dockerVolumeRemove(runner, projectVolumeName(projectId)) } catch { /* best-effort */ }
		try { await dockerStop(runner, managedPostgresContainerName(projectId), 10) } catch { /* best-effort */ }
		try { await dockerVolumeRemove(runner, managedPostgresVolumeName(projectId)) } catch { /* best-effort */ }

		await getCronScheduler().deleteProjectJobs(projectId)
		await db.delete(webhookDeliveries).where(eq(webhookDeliveries.projectId, projectId))
		await db.delete(envVars).where(eq(envVars.projectId, projectId))
		await db.delete(domains).where(eq(domains.projectId, projectId))
		await db.delete(deployments).where(eq(deployments.projectId, projectId))
		await db.delete(projects).where(eq(projects.id, projectId))

		redirect(303, '/')
	}
}

/** Build non-secret Postgres metadata for the settings panel. */
function buildPostgresMetadata(projectId: string, encryptedPassword: string | null) {
	const config = managedPostgresConfig(projectId)
	const password = encryptedPassword ? safeDecrypt(encryptedPassword) : ''
	const env = buildManagedPostgresEnv(config, password)

	return {
		database: config.database,
		username: config.username,
		host: config.containerName,
		volumeName: config.volumeName,
		urlPreview: env.DATABASE_URL.replace(/:([^:@/]+)@/, ':••••••••@')
	}
}
