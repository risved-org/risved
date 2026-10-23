import { db } from './db'
import { projects, domains } from './db/schema'
import { and, eq, ne } from 'drizzle-orm'

/** Legacy project domains are implicit root mounts and must not be claimed by another app. */
export async function hasRootConflict(hostname: string, projectId: string): Promise<boolean> {
	const owners = await db
		.select({ id: projects.id })
		.from(projects)
		.where(and(eq(projects.domain, hostname), ne(projects.id, projectId)))
		.limit(1)
	return owners.length > 0
}

/** Check explicit roots before changing a legacy project domain. */
export async function hasExplicitRootConflict(
	hostname: string,
	projectId: string
): Promise<boolean> {
	const owners = await db
		.select({ id: domains.id })
		.from(domains)
		.where(
			and(
				eq(domains.hostname, hostname),
				eq(domains.pathPrefix, '/'),
				ne(domains.projectId, projectId)
			)
		)
		.limit(1)
	return owners.length > 0
}
