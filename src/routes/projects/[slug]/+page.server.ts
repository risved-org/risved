import { error, fail, redirect } from '@sveltejs/kit';
import { createCommandRunner, dockerStop, dockerVolumeRemove, projectVolumeName } from '$lib/server/pipeline/docker';
import { db } from '$lib/server/db';
import {
	projects,
	deployments,
	domains,
	envVars,
	webhookDeliveries,
	healthEvents,
	cronJobs,
	cronRuns
} from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { safeDecrypt } from '$lib/server/crypto';
import { getHealthMonitor } from '$lib/server/health';
import { getProjectMetrics } from '$lib/server/metrics';
import type { PageServerLoad, Actions } from './$types';

import { getCronScheduler } from '$lib/server/cron';

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
};

/** Mask a secret value, showing only the first 4 chars of the decrypted value. */
function maskValue(value: string, isSecret: boolean): string {
	const plain = safeDecrypt(value);
	if (!isSecret) return plain;
	if (plain.length <= 4) return '••••';
	return plain.slice(0, 4) + '••••••••';
}

/** Fully mask a value with dots matching approximate length (±2 random offset). */
function dotMask(value: string): string {
	const plain = safeDecrypt(value);
	const len = plain.length
	if (len <= 2) return '••••'
	const offset = Math.floor(Math.random() * 5) - 2 // -2 to +2
	const dotCount = Math.max(4, len + offset)
	return '•'.repeat(dotCount)
}

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params;

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

	if (proj.length === 0) {
		error(404, 'Project not found');
	}

	const project = proj[0];

	/* Deployments (reverse-chronological, deduplicated by id) */
	const allDeps = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt));
	const seenIds = new Set<string>()
	const deps = allDeps.filter((d) => {
		if (seenIds.has(d.id)) return false
		seenIds.add(d.id)
		return true
	})

	/* Domains */
	const doms = await db.select().from(domains).where(eq(domains.projectId, project.id));

	/* Env vars (masked) */
	const envs = await db.select().from(envVars).where(eq(envVars.projectId, project.id));

	const maskedEnvs = envs.map((e) => ({
		id: e.id,
		key: e.key,
		value: maskValue(e.value, e.isSecret),
		dotMask: dotMask(e.value),
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

	/* Resource metrics (last 24h) */
	const metrics = await getProjectMetrics(project.id, 24);

	/* Cron jobs with latest run */
	const crons = await db
		.select()
		.from(cronJobs)
		.where(eq(cronJobs.projectId, project.id));

	const cronJobsWithLastRun = await Promise.all(
		crons.map(async (job) => {
			const lastRun = await db
				.select()
				.from(cronRuns)
				.where(eq(cronRuns.cronJobId, job.id))
				.orderBy(desc(cronRuns.startedAt))
				.limit(1);
			return {
				id: job.id,
				name: job.name,
				route: job.route,
				method: job.method,
				schedule: job.schedule,
				timezone: job.timezone,
				enabled: job.enabled,
				lastRun: lastRun[0]
					? {
							status: lastRun[0].status,
							statusCode: lastRun[0].statusCode,
							startedAt: lastRun[0].startedAt,
							durationMs: lastRun[0].durationMs
						}
					: null
			};
		})
	);

	/* Container health */
	const monitor = getHealthMonitor();
	const containerHealth = monitor.get(project.id);
	const recentHealthEvents = await db
		.select()
		.from(healthEvents)
		.where(eq(healthEvents.projectId, project.id))
		.orderBy(desc(healthEvents.createdAt))
		.limit(10);

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
			buildCommand: project.buildCommand ?? '',
			startCommand: project.startCommand ?? '',
			releaseCommand: project.releaseCommand ?? '',
			createdAt: project.createdAt
		},
		deployments: deps.map((d) => ({
			id: d.id,
			commitSha: d.commitSha,
			status: d.status,
			triggerType: d.triggerType,
			imageTag: d.imageTag,
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
		webhookActive: !!project.webhookSecret,
		containerHealth: containerHealth
			? {
					healthy: containerHealth.healthy,
					consecutiveFailures: containerHealth.consecutiveFailures,
					lastCheckAt: containerHealth.lastCheckAt,
					lastRestartAt: containerHealth.lastRestartAt,
					totalRestarts: containerHealth.totalRestarts
				}
			: null,
		healthEvents: recentHealthEvents.map((e) => ({
			id: e.id,
			event: e.event,
			message: e.message,
			createdAt: e.createdAt
		})),
		resourceMetrics: metrics,
		cronJobs: cronJobsWithLastRun
	};
};

export const actions: Actions = {
	saveScripts: async ({ params, request }) => {
		const { slug } = params
		const formData = await request.formData()
		const buildCommand = (formData.get('buildCommand') as string)?.trim() || null
		const startCommand = (formData.get('startCommand') as string)?.trim() || null
		const releaseCommand = (formData.get('releaseCommand') as string)?.trim() || null

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
		if (proj.length === 0) return fail(404, { error: 'Project not found' })

		await db
			.update(projects)
			.set({ buildCommand, startCommand, releaseCommand, updatedAt: new Date().toISOString() })
			.where(eq(projects.id, proj[0].id))

		return { scriptsSaved: true }
	},

	delete: async ({ params }) => {
		const { slug } = params;

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

		if (proj.length === 0) {
			return fail(404, { error: 'Project not found' });
		}

		const projectId = proj[0].id;

		/* Stop container and remove persistent volume */
		const runner = createCommandRunner()
		try { await dockerStop(runner, proj[0].slug, 10) } catch { /* may not be running */ }
		try { await dockerVolumeRemove(runner, projectVolumeName(projectId)) } catch { /* best-effort */ }

		/* Delete associated data */
		await getCronScheduler().deleteProjectJobs(projectId);
		await db.delete(webhookDeliveries).where(eq(webhookDeliveries.projectId, projectId));
		await db.delete(envVars).where(eq(envVars.projectId, projectId));
		await db.delete(domains).where(eq(domains.projectId, projectId));
		await db.delete(deployments).where(eq(deployments.projectId, projectId));
		await db.delete(projects).where(eq(projects.id, projectId));

		redirect(303, '/');
	}
};
