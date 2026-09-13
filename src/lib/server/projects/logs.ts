import { db } from '$lib/server/db'
import { buildLogs, deployments, projects } from '$lib/server/db/schema'
import { hintsFromLogs } from '$lib/server/hints'
import { desc, eq } from 'drizzle-orm'

import { projectUrl } from './read'
import { ServiceError, isTerminalStatus, type DeploymentDetail } from './types'
const DEFAULT_LOG_LINES = 80
const MAX_LOG_LINES = 400

/**
 * A deployment with the tail of its build output and any hints derived from it.
 *
 * `logLines` is clamped to [1, 400]: the point is a tail an agent can read in
 * one go, not the whole build.
 */
export async function getDeploymentDetail(
	deploymentId: string,
	logLines = DEFAULT_LOG_LINES
): Promise<DeploymentDetail> {
	const rows = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1)

	const deployment = rows[0]
	if (!deployment) {
		throw new ServiceError('not_found', `No deployment with id "${deploymentId}"`)
	}

	const project = (
		await db.select().from(projects).where(eq(projects.id, deployment.projectId)).limit(1)
	)[0]

	const limit = Math.min(Math.max(Math.trunc(logLines) || DEFAULT_LOG_LINES, 1), MAX_LOG_LINES)

	/* Newest `limit` rows, then flip back into reading order. */
	const tail = (
		await db
			.select()
			.from(buildLogs)
			.where(eq(buildLogs.deploymentId, deployment.id))
			.orderBy(desc(buildLogs.id))
			.limit(limit)
	).reverse()

	return {
		id: deployment.id,
		projectId: deployment.projectId,
		status: deployment.status,
		terminal: isTerminalStatus(deployment.status),
		ref: deployment.commitSha,
		commitMessage: null,
		startedAt: deployment.startedAt,
		finishedAt: deployment.finishedAt,
		url: project ? await projectUrl(project) : null,
		buildHints: hintsFromLogs(tail),
		logTail: tail.map((l) => `[${l.phase}] ${l.message}`).join('\n')
	}
}
