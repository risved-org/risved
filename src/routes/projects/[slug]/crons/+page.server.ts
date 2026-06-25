import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, cronJobs, cronRuns } from '$lib/server/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params

	const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (rows.length === 0) {
		error(404, 'Project not found')
	}

	const project = rows[0]
	const jobs = await db.select().from(cronJobs).where(eq(cronJobs.projectId, project.id))
	const cronJobsWithLastRun = await Promise.all(
		jobs.map(async (job) => {
			const lastRun = await db
				.select()
				.from(cronRuns)
				.where(eq(cronRuns.cronJobId, job.id))
				.orderBy(desc(cronRuns.startedAt))
				.limit(1)

			return {
				id: job.id,
				name: job.name,
				route: job.route,
				method: job.method,
				schedule: job.schedule,
				timezone: job.timezone,
				enabled: job.enabled,
				createdAt: job.createdAt,
				lastRun: lastRun[0]
					? {
							status: lastRun[0].status,
							statusCode: lastRun[0].statusCode,
							startedAt: lastRun[0].startedAt,
							completedAt: lastRun[0].completedAt,
							durationMs: lastRun[0].durationMs
						}
					: null
			}
		})
	)

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug
		},
		cronJobs: cronJobsWithLastRun
	}
}
