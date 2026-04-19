import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, deployments } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { runPipeline } from '$lib/server/pipeline'
import { createCommandRunner } from '$lib/server/pipeline/docker'
import type { FrameworkId, Tier } from '$lib/server/detection/types'
import type { RequestHandler } from './$types'

/**
 * POST /api/projects/:id/deploy — trigger a manual deployment.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id } = event.params
	const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)

	if (rows.length === 0) {
		return jsonError(404, 'Project not found')
	}

	const project = rows[0]

	if (!project.port) {
		return jsonError(400, 'Project has no port allocated')
	}

	const config = {
		projectId: project.id,
		projectSlug: project.slug,
		repoUrl: project.repoUrl,
		branch: project.branch,
		port: project.port,
		domain: project.domain ?? undefined,
		frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
		tier: (project.tier as Tier) ?? undefined,
		releaseCommand: project.releaseCommand
	}

	/* Create deployment record now so the client can navigate to it immediately */
	const deploymentId = crypto.randomUUID()
	await db.insert(deployments).values({
		id: deploymentId,
		projectId: project.id,
		status: 'running',
		startedAt: new Date().toISOString()
	})

	/* Start pipeline in background so the API responds immediately */
	runPipeline(config, createCommandRunner(), { deploymentId }).catch((err) => {
		console.error(`[deploy] Pipeline error for ${project.slug}:`, err)
	})

	return json({ success: true, deploymentId })
}
