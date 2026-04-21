import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { getProjectMetrics } from '$lib/server/metrics'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, url }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	const project = proj[0]
	const hoursParam = parseInt(url.searchParams.get('hours') ?? '24', 10)
	const hours = [6, 12, 24, 48, 168].includes(hoursParam) ? hoursParam : 24

	const metrics = await getProjectMetrics(project.id, hours)

	return {
		resourceMetrics: metrics,
		hours
	}
}
