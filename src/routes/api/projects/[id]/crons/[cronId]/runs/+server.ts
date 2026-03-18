import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { cronJobs, cronRuns } from '$lib/server/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import type { RequestHandler } from './$types'

/**
 * GET /api/projects/:id/crons/:cronId/runs — get run history for a cron job.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id, cronId } = event.params

	const job = await db
		.select()
		.from(cronJobs)
		.where(and(eq(cronJobs.id, cronId), eq(cronJobs.projectId, id)))
		.limit(1)

	if (job.length === 0) return jsonError(404, 'Cron job not found')

	const runs = await db
		.select()
		.from(cronRuns)
		.where(eq(cronRuns.cronJobId, cronId))
		.orderBy(desc(cronRuns.startedAt))
		.limit(50)

	return json(runs)
}
