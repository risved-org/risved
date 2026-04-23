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

	const IN_PROGRESS = new Set(['running', 'cloning', 'detecting', 'building', 'starting'])

	const recentDeps = await db
		.select({ status: deployments.status })
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt))
		.limit(5)

	let status = recentDeps[0]?.status ?? 'stopped'

	/* If latest deployment is in-progress but a previous one is live,
	   show as live — the old container is still serving traffic */
	if (IN_PROGRESS.has(status) && recentDeps.some((d) => d.status === 'live')) {
		status = 'live'
	}

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
