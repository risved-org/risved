import { db } from '$lib/server/db'
import { deployments, envVars, projects } from '$lib/server/db/schema'
import { getManagedAppDomain } from '$lib/server/pipeline/domains'
import { asc, desc, eq, inArray } from 'drizzle-orm'

import {
	isTerminalStatus,
	ServiceError,
	type DeploymentSummary,
	type ProjectDetail,
	type ProjectSummary
} from './types'
export type ProjectRow = typeof projects.$inferSelect
export type DeploymentRow = typeof deployments.$inferSelect

function toDeploymentSummary(row: DeploymentRow): DeploymentSummary {
	return {
		id: row.id,
		status: row.status,
		terminal: isTerminalStatus(row.status),
		createdAt: row.createdAt
	}
}

/**
 * The address the project is served at: its own domain, else the wildcard
 * subdomain the control plane routes. Null when neither is configured.
 */
export async function projectUrl(project: ProjectRow): Promise<string | null> {
	if (project.domain) return `https://${project.domain}`
	const managed = await getManagedAppDomain(project.slug)
	return managed ? `https://${managed}` : null
}

export async function toSummary(
	project: ProjectRow,
	last: DeploymentRow | null
): Promise<ProjectSummary> {
	return {
		id: project.id,
		name: project.name,
		slug: project.slug,
		repo: project.repoUrl,
		branch: project.branch,
		framework: project.frameworkId,
		url: await projectUrl(project),
		lastDeployment: last ? toDeploymentSummary(last) : null
	}
}

/** Every project, newest first, each with its latest deployment. */
export async function listProjects(): Promise<ProjectSummary[]> {
	const rows = await db.select().from(projects).orderBy(desc(projects.createdAt))
	if (rows.length === 0) return []

	/* One query for every project's deployments, then pick the newest per id. */
	const allDeployments = await db
		.select()
		.from(deployments)
		.where(
			inArray(
				deployments.projectId,
				rows.map((r) => r.id)
			)
		)
		.orderBy(desc(deployments.createdAt))

	const latest = new Map<string, DeploymentRow>()
	for (const deployment of allDeployments) {
		if (!latest.has(deployment.projectId)) latest.set(deployment.projectId, deployment)
	}

	return Promise.all(rows.map((row) => toSummary(row, latest.get(row.id) ?? null)))
}

/** Look a project up by id, or by slug when the id is not a match. */
export async function findProject(idOrSlug: string): Promise<ProjectRow | null> {
	const byId = await db.select().from(projects).where(eq(projects.id, idOrSlug)).limit(1)
	if (byId.length > 0) return byId[0]

	const bySlug = await db.select().from(projects).where(eq(projects.slug, idOrSlug)).limit(1)
	return bySlug[0] ?? null
}

export async function requireProject(idOrSlug: string): Promise<ProjectRow> {
	const project = await findProject(idOrSlug)
	if (!project) throw new ServiceError('not_found', `No project with id "${idOrSlug}"`)
	return project
}

/** Project detail: env var names, current deployment, and the last five. */
export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
	const project = await requireProject(projectId)

	const recent = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt))
		.limit(5)

	const envRows = await db
		.select({ key: envVars.key })
		.from(envVars)
		.where(eq(envVars.projectId, project.id))
		.orderBy(asc(envVars.key))

	const current = recent.find((d) => d.status === 'live') ?? null
	const summary = await toSummary(project, recent[0] ?? null)

	return {
		...summary,
		envVarNames: envRows.map((r) => r.key),
		buildCommand: project.buildCommand,
		startCommand: project.startCommand,
		releaseCommand: project.releaseCommand,
		currentDeployment: current ? toDeploymentSummary(current) : null,
		recentDeployments: recent.map(toDeploymentSummary),
		createdAt: project.createdAt
	}
}
