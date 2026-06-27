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

export const load = (async (event?: Parameters<PageServerLoad>[0]) => {
	void event
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
	const BUILD_NOTICE_STATUSES = new Set([...IN_PROGRESS, 'failed'])
	type DeploymentSummary = { status: string; commitSha: string | null; createdAt: string }
	const latestDeployMap = new Map<string, DeploymentSummary>()
	const liveDeployMap = new Map<string, DeploymentSummary>()
	for (const dep of allDeployments) {
		if (!latestDeployMap.has(dep.projectId)) {
			latestDeployMap.set(dep.projectId, {
				status: dep.status,
				commitSha: dep.commitSha,
				createdAt: dep.createdAt
			})
		}
		if (dep.status === 'live' && !liveDeployMap.has(dep.projectId)) {
			liveDeployMap.set(dep.projectId, {
				status: dep.status,
				commitSha: dep.commitSha,
				createdAt: dep.createdAt
			})
		}
	}

	const domainMap = new Map(primaryDomains.map((d) => [d.projectId, d.hostname]))

	/* Health monitor status per project */
	const monitor = getHealthMonitor()
	const healthMap = new Map(monitor.getAll().map((h) => [h.projectId, h]))

	const projectList = allProjects.map((p) => {
		const latestDeployment = latestDeployMap.get(p.id)
		const liveDeployment = liveDeployMap.get(p.id)
		const productionDeployment = liveDeployment ?? latestDeployment
		const buildNotice =
			latestDeployment && BUILD_NOTICE_STATUSES.has(latestDeployment.status)
				? latestDeployment
				: null
		const containerHealth = healthMap.get(p.id)
		return {
			id: p.id,
			name: p.name,
			slug: p.slug,
			framework: p.frameworkId ? (_FRAMEWORK_NAMES[p.frameworkId] ?? p.frameworkId) : null,
			frameworkId: p.frameworkId,
			domain: domainMap.get(p.id) ?? p.domain ?? null,
			status: productionDeployment?.status ?? 'stopped',
			commitSha: productionDeployment?.commitSha ?? null,
			lastDeployedAt: productionDeployment?.createdAt ?? null,
			buildStatus: buildNotice?.status ?? null,
			buildCommitSha: buildNotice?.commitSha ?? null,
			containerHealthy: containerHealth?.healthy ?? null,
			totalRestarts: containerHealth?.totalRestarts ?? 0
		}
	})

	return { projects: projectList }
}) satisfies PageServerLoad
