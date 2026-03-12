import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, deployments, domains, buildLogs } from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/** Map pipeline phases to display order and label */
const PHASE_LABELS: Record<string, string> = {
	clone: 'Clone',
	detect: 'Detect',
	build: 'Build',
	start: 'Start',
	health: 'Health',
	route: 'Route',
	cutover: 'Cutover',
	live: 'Live'
};

/** Ordered phase list for the indicator */
const PHASE_ORDER = ['clone', 'detect', 'build', 'start', 'health', 'live'];

export const load: PageServerLoad = async ({ params }) => {
	const { slug, did } = params;

	/* Find project by slug */
	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

	if (proj.length === 0) {
		error(404, 'Project not found');
	}

	const project = proj[0];

	/* Find deployment */
	const dep = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, did), eq(deployments.projectId, project.id)))
		.limit(1);

	if (dep.length === 0) {
		error(404, 'Deployment not found');
	}

	const deployment = dep[0];

	/* Get primary domain */
	const domainRows = await db
		.select({ hostname: domains.hostname })
		.from(domains)
		.where(and(eq(domains.projectId, project.id), eq(domains.isPrimary, true)))
		.limit(1);

	const primaryDomain = domainRows[0]?.hostname ?? project.domain ?? null;

	/* Get initial build logs */
	const logs = await db
		.select()
		.from(buildLogs)
		.where(eq(buildLogs.deploymentId, did))
		.orderBy(asc(buildLogs.timestamp));

	const isTerminal = ['live', 'failed', 'stopped'].includes(deployment.status);

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug,
			domain: primaryDomain
		},
		deployment: {
			id: deployment.id,
			status: deployment.status,
			commitSha: deployment.commitSha,
			startedAt: deployment.startedAt,
			finishedAt: deployment.finishedAt,
			createdAt: deployment.createdAt
		},
		logs: logs.map((l) => ({
			timestamp: l.timestamp,
			phase: l.phase,
			level: l.level,
			message: l.message
		})),
		isTerminal,
		phases: PHASE_ORDER.map((id) => ({ id, label: PHASE_LABELS[id] ?? id }))
	};
};
