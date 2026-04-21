import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, deployments } from '$lib/server/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	const project = proj[0]

	const allDeps = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt))

	const seenIds = new Set<string>()
	const deps = allDeps.filter((d) => {
		if (seenIds.has(d.id)) return false
		seenIds.add(d.id)
		return true
	})

	return {
		deployments: deps.map((d) => ({
			id: d.id,
			commitSha: d.commitSha,
			status: d.status,
			triggerType: d.triggerType,
			imageTag: d.imageTag,
			createdAt: d.createdAt,
			finishedAt: d.finishedAt
		}))
	}
}
