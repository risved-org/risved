import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, deployments, domains, envVars, webhookDeliveries } from '$lib/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';

const FRAMEWORK_NAMES: Record<string, string> = {
	sveltekit: 'SvelteKit',
	fresh: 'Fresh',
	astro: 'Astro',
	hono: 'Hono',
	nextjs: 'Next.js',
	nuxt: 'Nuxt',
	lume: 'Lume',
	solidstart: 'SolidStart'
};

/** Mask a secret value, showing only the first 4 chars. */
function maskValue(value: string, isSecret: boolean): string {
	if (!isSecret) return value;
	if (value.length <= 4) return '••••';
	return value.slice(0, 4) + '••••••••';
}

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params;

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

	if (proj.length === 0) {
		error(404, 'Project not found');
	}

	const project = proj[0];

	/* Deployments (reverse-chronological) */
	const deps = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt));

	/* Domains */
	const doms = await db.select().from(domains).where(eq(domains.projectId, project.id));

	/* Env vars (masked) */
	const envs = await db.select().from(envVars).where(eq(envVars.projectId, project.id));

	const maskedEnvs = envs.map((e) => ({
		id: e.id,
		key: e.key,
		value: maskValue(e.value, e.isSecret),
		isSecret: e.isSecret
	}));

	/* Latest webhook delivery */
	const lastDelivery = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.projectId, project.id))
		.orderBy(desc(webhookDeliveries.createdAt))
		.limit(1);

	/* Primary domain */
	const primaryDomain = doms.find((d) => d.isPrimary)?.hostname ?? project.domain ?? null;

	/* Latest deployment status */
	const latestDep = deps[0] ?? null;
	const status = latestDep?.status ?? 'stopped';

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
			webhookSecret: project.webhookSecret,
			port: project.port,
			status,
			createdAt: project.createdAt
		},
		deployments: deps.map((d) => ({
			id: d.id,
			commitSha: d.commitSha,
			status: d.status,
			createdAt: d.createdAt,
			finishedAt: d.finishedAt
		})),
		domains: doms.map((d) => ({
			id: d.id,
			hostname: d.hostname,
			isPrimary: d.isPrimary,
			sslStatus: d.sslStatus,
			verifiedAt: d.verifiedAt
		})),
		envVars: maskedEnvs,
		lastWebhookAt: lastDelivery[0]?.createdAt ?? null,
		webhookActive: !!project.webhookSecret
	};
};

export const actions: Actions = {
	delete: async ({ params }) => {
		const { slug } = params;

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

		if (proj.length === 0) {
			return fail(404, { error: 'Project not found' });
		}

		const projectId = proj[0].id;

		/* Delete associated data */
		await db.delete(webhookDeliveries).where(eq(webhookDeliveries.projectId, projectId));
		await db.delete(envVars).where(eq(envVars.projectId, projectId));
		await db.delete(domains).where(eq(domains.projectId, projectId));
		await db.delete(deployments).where(eq(deployments.projectId, projectId));
		await db.delete(projects).where(eq(projects.id, projectId));

		redirect(303, '/');
	}
};
