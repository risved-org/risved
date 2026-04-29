import { db } from '$lib/server/db'
import { projects, deployments, domains } from '$lib/server/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getHealthMonitor } from '$lib/server/health'
import type { PageServerLoad } from './$types'

/** Map framework IDs to display names */
export const _FRAMEWORK_NAMES: Record<string, string> = {
	sveltekit: 'SvelteKit',
	fresh: 'Fresh',
	astro: 'Astro',
	hono: 'Hono',
	nextjs: 'Next.js',
	nuxt2: 'Nuxt 2',
	nuxt: 'Nuxt',
	lume: 'Lume',
	solidstart: 'SolidStart'
}

export const load: PageServerLoad = async () => {
	/* Fetch all projects */
	const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt))

	/* Fetch latest deployment per project */
	const allDeployments = await db.select().from(deployments).orderBy(desc(deployments.createdAt))

	/* Fetch primary domains */
	const primaryDomains = await db
		.select({ projectId: domains.projectId, hostname: domains.hostname })
		.from(domains)
		.where(eq(domains.isPrimary, true))

	/* Build lookup maps */
	const IN_PROGRESS = new Set(['running', 'cloning', 'detecting', 'building', 'starting'])
	const latestDeployMap = new Map<
		string,
		{ status: string; commitSha: string | null; createdAt: string }
	>()
	for (const dep of allDeployments) {
		if (!latestDeployMap.has(dep.projectId)) {
			latestDeployMap.set(dep.projectId, {
				status: dep.status,
				commitSha: dep.commitSha,
				createdAt: dep.createdAt
			})
		}
		/* If latest deployment is in-progress but there's a previous live deployment,
		   show the project as live — the old container is still serving traffic */
		const existing = latestDeployMap.get(dep.projectId)!
		if (IN_PROGRESS.has(existing.status) && dep.status === 'live') {
			existing.status = 'live'
		}
	}

	const domainMap = new Map(primaryDomains.map((d) => [d.projectId, d.hostname]))

	/* Health monitor status per project */
	const monitor = getHealthMonitor()
	const healthMap = new Map(monitor.getAll().map((h) => [h.projectId, h]))

	const projectList = allProjects.map((p) => {
		const dep = latestDeployMap.get(p.id)
		const containerHealth = healthMap.get(p.id)
		return {
			id: p.id,
			name: p.name,
			slug: p.slug,
			framework: p.frameworkId ? (_FRAMEWORK_NAMES[p.frameworkId] ?? p.frameworkId) : null,
			frameworkId: p.frameworkId,
			domain: domainMap.get(p.id) ?? p.domain ?? null,
			status: dep?.status ?? 'stopped',
			commitSha: dep?.commitSha ?? null,
			lastDeployedAt: dep?.createdAt ?? null,
			containerHealthy: containerHealth?.healthy ?? null,
			totalRestarts: containerHealth?.totalRestarts ?? 0
		}
	})

	return { projects: projectList }
}
