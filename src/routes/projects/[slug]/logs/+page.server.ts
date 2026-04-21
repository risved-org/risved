import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	return {}
}
