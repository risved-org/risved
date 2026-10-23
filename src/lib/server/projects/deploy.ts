import { db } from '$lib/server/db'
import { deployments } from '$lib/server/db/schema'
import type { FrameworkId, Tier } from '$lib/server/detection/types'
import { runPipeline } from '$lib/server/pipeline'
import { createCommandRunner } from '$lib/server/pipeline/docker'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { requireProject, type DeploymentRow, type ProjectRow } from './read'
import { productionDeploymentScope } from './production-scope'
import { ServiceError } from './types'
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString()

export interface EnqueuedDeployment {
	deploymentId: string
	status: string
	terminal: boolean
}

export interface DeployOptions {
	/** Commit SHA or branch to build. Defaults to the project's branch head. */
	ref?: string
	/**
	 * Queue behind a build that is already running instead of refusing.
	 *
	 * The dashboard does this — a person pressing Deploy means "again, now",
	 * and the pipeline serialises per project anyway. Agents do not: a retry
	 * loop that queues a build per poll is how you get twelve of them.
	 */
	allowConcurrent?: boolean
}

/**
 * Start a deployment for a project.
 *
 * Returns as soon as the deployment row exists; the build runs in the
 * background. Throws `deploy_in_progress`, carrying the running deployment's
 * id, unless the caller opted into queueing.
 */
export async function deployProject(
	projectId: string,
	options: DeployOptions = {}
): Promise<EnqueuedDeployment> {
	const ref = options.ref?.trim()
	if (ref?.startsWith('-') || ref?.includes('\0'))
		throw new ServiceError('validation', 'Invalid checkout ref')
	const project = await requireProject(projectId)

	if (!project.port) {
		throw new ServiceError('validation', 'Project has no port allocated')
	}

	if (!options.allowConcurrent) {
		await db
			.update(deployments)
			.set({ status: 'failed', finishedAt: new Date().toISOString() })
			.where(
				and(
					eq(deployments.projectId, project.id),
					inArray(deployments.status, ['pending', 'running']),
					productionDeploymentScope(),
					sql`coalesce(${deployments.startedAt}, ${deployments.createdAt}) < ${PROCESS_STARTED_AT}`
				)
			)
		const running = await findRunningDeployment(project.id)
		if (running) {
			throw new ServiceError(
				'deploy_in_progress',
				`A deployment is already running for "${project.slug}"`,
				{ deploymentId: running.id, status: running.status }
			)
		}
	}

	const deploymentId = crypto.randomUUID()
	await db.insert(deployments).values({
		id: deploymentId,
		projectId: project.id,
		status: 'running',
		startedAt: new Date().toISOString()
	})

	/* Background: the caller gets the id immediately and polls for the rest. */
	runPipeline(pipelineConfig(project, options.ref), createCommandRunner(), { deploymentId })
		.catch(async (err) => {
			console.error(`[deploy] Pipeline error for ${project.slug}:`, err)
			await db
				.update(deployments)
				.set({ status: 'failed', finishedAt: new Date().toISOString() })
				.where(eq(deployments.id, deploymentId))
		})
		.catch((err) => console.error('[deploy] Could not finalize failed deployment:', err))

	return { deploymentId, status: 'running', terminal: false }
}

/** The in-flight deployment for a project, if there is one. */
export async function findRunningDeployment(projectId: string): Promise<DeploymentRow | null> {
	const rows = await db
		.select()
		.from(deployments)
		.where(
			and(
				eq(deployments.projectId, projectId),
				inArray(deployments.status, ['pending', 'running']),
				productionDeploymentScope()
			)
		)
		.orderBy(desc(deployments.createdAt))
		.limit(1)
	return rows[0] ?? null
}

/** Build the pipeline config for a project row, optionally pinned to a ref. */
export function pipelineConfig(project: ProjectRow, ref?: string) {
	return {
		projectId: project.id,
		projectSlug: project.slug,
		repoUrl: project.repoUrl,
		branch: project.branch,
		checkoutRef: ref?.trim() || null,
		gitConnectionId: project.gitConnectionId,
		port: project.port!,
		domain: project.domain ?? undefined,
		frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
		tier: (project.tier as Tier) ?? undefined,
		buildCommand: project.buildCommand,
		runtime: project.runtime,
		startCommand: project.startCommand,
		releaseCommand: project.releaseCommand,
		postgresEnabled: project.postgresEnabled,
		postgresPassword: project.postgresPassword
	}
}
