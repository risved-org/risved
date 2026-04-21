import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, domains, deployments } from '$lib/server/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { LayoutServerLoad } from './$types'

const FRAMEWORK_NAMES: Record<string, string> = {
	sveltekit: 'SvelteKit',
	fresh: 'Fresh',
	astro: 'Astro',
	hono: 'Hono',
	nextjs: 'Next.js',
	nuxt: 'Nuxt',
	lume: 'Lume',
	solidstart: 'SolidStart',
	'tanstack-start': 'TanStack Start',
	generic: 'Generic'
}

export const load: LayoutServerLoad = async ({ params }) => {
	const { slug } = params

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (proj.length === 0) {
		error(404, 'Project not found')
	}

	const project = proj[0]

	const doms = await db.select().from(domains).where(eq(domains.projectId, project.id))
	const primaryDomain = doms.find((d) => d.isPrimary)?.hostname ?? project.domain ?? null

	const latestDep = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt))
		.limit(1)

	const status = latestDep[0]?.status ?? 'stopped'

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug,
			repoUrl: project.repoUrl,
			branch: project.branch,
			framework: project.frameworkId
				? (FRAMEWORK_NAMES[project.frameworkId] ?? project.frameworkId)
				: null,
			frameworkId: project.frameworkId,
			domain: primaryDomain,
			port: project.port,
			status
		}
	}
}
