import { db } from '$lib/server/db'
import { deployments } from '$lib/server/db/schema'
import { and, eq, ne } from 'drizzle-orm'

/**
 * Demote the deployments that `deploymentId` just replaced from `live` to
 * `superseded`. Only rows for the same container are touched: production and
 * PR previews share a project id but run as different containers, so a
 * preview going live must not demote the production deployment (or vice
 * versa). Superseded rows keep their image tag and stay eligible for rollback.
 */
export async function supersedeLiveDeployments(
	projectId: string,
	containerName: string,
	deploymentId: string
): Promise<void> {
	await db
		.update(deployments)
		.set({ status: 'superseded' })
		.where(
			and(
				eq(deployments.projectId, projectId),
				eq(deployments.status, 'live'),
				eq(deployments.containerName, containerName),
				ne(deployments.id, deploymentId)
			)
		)
}
