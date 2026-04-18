import { json, error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { createCommandRunner, getContainerLogs } from '$lib/server/pipeline/docker'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, url }) => {
	const proj = await db.select().from(projects).where(eq(projects.id, params.id)).limit(1)
	if (proj.length === 0) error(404, 'Project not found')

	const tail = Math.min(Number(url.searchParams.get('tail') ?? 200), 1000)
	const runner = createCommandRunner()
	const logs = await getContainerLogs(runner, proj[0].slug, tail)

	return json({ logs })
}
