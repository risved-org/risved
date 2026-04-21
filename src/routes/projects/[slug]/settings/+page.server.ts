import { error, fail, redirect } from '@sveltejs/kit'
import { createCommandRunner, dockerStop, dockerVolumeRemove, projectVolumeName } from '$lib/server/pipeline/docker'
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

/** Fully mask a value with a fixed dot count */
function dotMask(value: string): string {
	const plain = safeDecrypt(value)
	if (plain.length <= 2) return '••••••••'
	return '••••••••'
}

export const load: PageServerLoad = async ({ params }) => {
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
		envVars: envs.map((e) => ({
			id: e.id,
			key: e.key,
			value: safeDecrypt(e.value),
			dotMask: dotMask(e.value),
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
}

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

		const envKeysRaw = formData.get('envKeys') as string | null
		const envValsRaw = formData.get('envValues') as string | null
		const envSecretsRaw = formData.get('envSecrets') as string | null

		const envKeys = envKeysRaw ? envKeysRaw.split('\x1F') : []
		const envValues = envValsRaw ? envValsRaw.split('\x1F') : []
		const envSecrets = envSecretsRaw ? envSecretsRaw.split('\x1F') : []

		await db.delete(envVars).where(eq(envVars.projectId, projectId))

		for (let i = 0; i < envKeys.length; i++) {
			const key = envKeys[i]?.trim()
			const value = envValues[i] ?? ''
			const isSecret = envSecrets[i] === '1'
			if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				await db.insert(envVars).values({
					projectId,
					key,
					value: encrypt(value),
					isSecret
				})
			}
		}

		return { envSaved: true }
	},

	delete: async ({ params }) => {
		const { slug } = params

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { error: 'Project not found' })

		const projectId = proj[0].id

		const runner = createCommandRunner()
		try { await dockerStop(runner, proj[0].slug, 10) } catch { /* may not be running */ }
		try { await dockerVolumeRemove(runner, projectVolumeName(projectId)) } catch { /* best-effort */ }

		await getCronScheduler().deleteProjectJobs(projectId)
		await db.delete(webhookDeliveries).where(eq(webhookDeliveries.projectId, projectId))
		await db.delete(envVars).where(eq(envVars.projectId, projectId))
		await db.delete(domains).where(eq(domains.projectId, projectId))
		await db.delete(deployments).where(eq(deployments.projectId, projectId))
		await db.delete(projects).where(eq(projects.id, projectId))

		redirect(303, '/')
	}
}
