import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, deployments } from '$lib/server/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { runPipeline } from '$lib/server/pipeline'
import { createCommandRunner } from '$lib/server/pipeline/docker'
import type { FrameworkId, Tier } from '$lib/server/detection/types'
import type { RequestHandler } from './$types'

/**
 * POST /api/projects/:id/deployments/:did/rebuild — rebuild a historical commit.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id, did } = event.params

	const projectRows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
	if (projectRows.length === 0) {
		return jsonError(404, 'Project not found')
	}

	const project = projectRows[0]
	if (!project.port) {
		return jsonError(400, 'Project has no port allocated')
	}

	const deploymentRows = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, did), eq(deployments.projectId, id)))
		.limit(1)

	if (deploymentRows.length === 0) {
		return jsonError(404, 'Deployment not found')
	}

	const deployment = deploymentRows[0]
	if (!deployment.commitSha) {
		return jsonError(400, 'Deployment has no commit to rebuild')
	}

	const config = {
		projectId: project.id,
		projectSlug: project.slug,
		repoUrl: project.repoUrl,
		branch: project.branch,
		checkoutRef: deployment.commitSha,
		gitConnectionId: project.gitConnectionId,
		port: project.port,
		domain: project.domain ?? undefined,
		frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
		tier: (project.tier as Tier) ?? undefined,
		buildCommand: project.buildCommand,
		startCommand: project.startCommand,
		releaseCommand: project.releaseCommand,
		postgresEnabled: project.postgresEnabled,
		postgresPassword: project.postgresPassword
	}

	const deploymentId = crypto.randomUUID()
	await db.insert(deployments).values({
		id: deploymentId,
		projectId: project.id,
		status: 'running',
		triggerType: 'rebuild',
		commitSha: deployment.commitSha,
		startedAt: new Date().toISOString()
	})

	runPipeline(config, createCommandRunner(), { deploymentId }).catch((err) => {
		console.error(`[rebuild] Pipeline error for ${project.slug}@${deployment.commitSha}:`, err)
	})

	return json({ success: true, deploymentId })
}
