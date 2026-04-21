import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, deployments, healthEvents } from '$lib/server/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getHealthMonitor } from '$lib/server/health'
import { getProjectMetrics } from '$lib/server/metrics'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	const project = proj[0]

	/* Last 10 deployments */
	const allDeps = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt))
		.limit(10)

	const seenIds = new Set<string>()
	const deps = allDeps.filter((d) => {
		if (seenIds.has(d.id)) return false
		seenIds.add(d.id)
		return true
	})

	/* Container health */
	const monitor = getHealthMonitor()
	const containerHealth = monitor.get(project.id)
	const recentHealthEvents = await db
		.select()
		.from(healthEvents)
		.where(eq(healthEvents.projectId, project.id))
		.orderBy(desc(healthEvents.createdAt))
		.limit(10)

	/* Resource metrics (last 24h) */
	const metrics = await getProjectMetrics(project.id, 24)

	return {
		deployments: deps.map((d) => ({
			id: d.id,
			commitSha: d.commitSha,
			status: d.status,
			triggerType: d.triggerType,
			imageTag: d.imageTag,
			createdAt: d.createdAt,
			finishedAt: d.finishedAt
		})),
		containerHealth: containerHealth
			? {
					healthy: containerHealth.healthy,
					consecutiveFailures: containerHealth.consecutiveFailures,
					lastCheckAt: containerHealth.lastCheckAt,
					lastRestartAt: containerHealth.lastRestartAt,
					totalRestarts: containerHealth.totalRestarts
				}
			: null,
		healthEvents: recentHealthEvents.map((e) => ({
			id: e.id,
			event: e.event,
			message: e.message,
			createdAt: e.createdAt
		})),
		resourceMetrics: metrics
	}
}
