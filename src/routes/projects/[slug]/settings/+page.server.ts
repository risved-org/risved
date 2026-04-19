import { error, fail } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, envVars, deployments } from '$lib/server/db/schema'
import { eq, and, desc, isNotNull } from 'drizzle-orm'
import { encrypt, safeDecrypt } from '$lib/server/crypto'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	const project = proj[0]

	const envs = await db.select().from(envVars).where(eq(envVars.projectId, project.id))

	/* Last deployment that actually ran a release command (for the settings panel). */
	const lastReleaseRows = await db
		.select()
		.from(deployments)
		.where(
			and(eq(deployments.projectId, project.id), isNotNull(deployments.releaseCommand))
		)
		.orderBy(desc(deployments.createdAt))
		.limit(1)

	const lastRelease = lastReleaseRows[0]
		? {
				command: lastReleaseRows[0].releaseCommand!,
				status:
					lastReleaseRows[0].releaseExitCode === 0
						? 'success'
						: lastReleaseRows[0].releaseExitCode == null
							? lastReleaseRows[0].status
							: 'failed',
				timestamp: lastReleaseRows[0].finishedAt ?? lastReleaseRows[0].createdAt,
				deploymentId: lastReleaseRows[0].id,
				projectSlug: project.slug
			}
		: null

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug,
			repoUrl: project.repoUrl,
			branch: project.branch,
			releaseCommand: project.releaseCommand ?? ''
		},
		envVars: envs.map((e) => ({
			id: e.id,
			key: e.key,
			value: safeDecrypt(e.value),
			isSecret: e.isSecret
		})),
		lastRelease
	}
}

export const actions: Actions = {
	save: async ({ params, request }) => {
		const { slug } = params
		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { error: 'Project not found' })

		const projectId = proj[0].id
		const formData = await request.formData()

		const envKeysRaw = formData.get('envKeys') as string | null
		const envValsRaw = formData.get('envValues') as string | null
		const envSecretsRaw = formData.get('envSecrets') as string | null
		const releaseCommand = (formData.get('releaseCommand') as string | null)?.trim() ?? ''

		const envKeys = envKeysRaw ? envKeysRaw.split('\x1F') : []
		const envValues = envValsRaw ? envValsRaw.split('\x1F') : []
		const envSecrets = envSecretsRaw ? envSecretsRaw.split('\x1F') : []

		/* Delete all existing env vars and re-insert */
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

		await db
			.update(projects)
			.set({
				releaseCommand: releaseCommand || null,
				updatedAt: new Date().toISOString()
			})
			.where(eq(projects.id, projectId))

		return { success: true }
	}
}
