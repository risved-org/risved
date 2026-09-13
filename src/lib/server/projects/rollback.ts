import { db } from '$lib/server/db'
import { deployments } from '$lib/server/db/schema'
import { createCommandRunner } from '$lib/server/pipeline/docker'
import { runRollback } from '$lib/server/pipeline/rollback'
import { and, eq } from 'drizzle-orm'

import type { EnqueuedDeployment } from './deploy'
import { requireProject } from './read'
import { ServiceError } from './types'
/**
 * Redeploy a previous deployment's cached image.
 *
 * Runs synchronously in the pipeline's rollback path (no rebuild, so it is
 * quick) but returns the same shape as `deployProject`.
 */
export async function rollbackProject(
	projectId: string,
	toDeploymentId: string
): Promise<EnqueuedDeployment> {
	const project = await requireProject(projectId)

	if (!project.port) {
		throw new ServiceError('validation', 'Project has no port allocated')
	}

	const rows = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, toDeploymentId), eq(deployments.projectId, project.id)))
		.limit(1)

	const target = rows[0]
	if (!target) {
		throw new ServiceError(
			'not_found',
			`Deployment "${toDeploymentId}" does not belong to project "${project.slug}"`
		)
	}
	if (!['live', 'stopped', 'superseded'].includes(target.status)) {
		throw new ServiceError('validation', 'Can only roll back to a previously successful deployment')
	}
	if (!target.imageTag) {
		throw new ServiceError('validation', 'That deployment has no cached image to roll back to')
	}

	/*
	 * Deliberately not guarded on a running deployment: a rollback is usually a
	 * response to the build that is running. The pipeline's per-project lock
	 * keeps the container work serialised.
	 */
	const result = await runRollback(
		{
			projectId: project.id,
			projectSlug: project.slug,
			imageTag: target.imageTag,
			commitSha: target.commitSha,
			port: project.port,
			domain: project.domain ?? undefined,
			postgresEnabled: project.postgresEnabled,
			postgresPassword: project.postgresPassword
		},
		createCommandRunner()
	)

	if (!result.success) {
		throw new ServiceError('internal', result.error ?? 'Rollback failed', {
			deploymentId: result.deploymentId
		})
	}

	return { deploymentId: result.deploymentId, status: 'live', terminal: true }
}
