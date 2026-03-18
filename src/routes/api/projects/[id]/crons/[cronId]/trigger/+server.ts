import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { cronJobs } from '$lib/server/db/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getCronScheduler } from '$lib/server/cron'
import type { RequestHandler } from './$types'

/**
 * POST /api/projects/:id/crons/:cronId/trigger — manually trigger a cron job.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id, cronId } = event.params

	const rows = await db
		.select()
		.from(cronJobs)
		.where(and(eq(cronJobs.id, cronId), eq(cronJobs.projectId, id)))
		.limit(1)

	if (rows.length === 0) return jsonError(404, 'Cron job not found')

	const result = await getCronScheduler().execute(cronId)
	if (!result) return jsonError(400, 'No live deployment to execute against')

	return json({ triggered: true, result })
}
