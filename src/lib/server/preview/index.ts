import { db } from '$lib/server/db';
import { previewDeployments, deployments } from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { CaddyClient } from '$lib/server/caddy';
import { runPipeline } from '$lib/server/pipeline';
import { createCommandRunner, dockerStop } from '$lib/server/pipeline/docker';
import { getSetting } from '$lib/server/settings';
import type { FrameworkId, Tier } from '$lib/server/detection/types';
import type { PreviewProject, PreviewResult } from './types';

export type { PreviewProject, PreviewResult } from './types';

const PREVIEW_PORT_MIN = 4001;
const PREVIEW_PORT_MAX = 4999;

/**
 * Build the preview domain for a PR.
 * Format: pr-{number}.{projectSlug}.{risvedDomain}
 */
export function buildPreviewDomain(
	prNumber: number,
	projectSlug: string,
	baseDomain: string
): string {
	return `pr-${prNumber}.${projectSlug}.${baseDomain}`;
}

/**
 * Allocate a port for a preview deployment from the 4001-4999 range.
 */
export async function allocatePreviewPort(): Promise<number> {
	const used = await db
		.select({ port: previewDeployments.port })
		.from(previewDeployments)
		.where(eq(previewDeployments.status, 'active'));

	const usedSet = new Set(used.map((r) => r.port).filter((p): p is number => p !== null));

	for (let port = PREVIEW_PORT_MIN; port <= PREVIEW_PORT_MAX; port++) {
		if (!usedSet.has(port)) {
			return port;
		}
	}

	throw new Error(`No available preview ports in range ${PREVIEW_PORT_MIN}-${PREVIEW_PORT_MAX}`);
}

/**
 * Create a preview deployment for a pull request.
 * Allocates port, enforces limit, creates record, and triggers pipeline.
 */
export async function createPreview(
	project: PreviewProject,
	prNumber: number,
	prTitle: string | null,
	branch: string,
	commitSha: string | null
): Promise<PreviewResult> {
	const baseDomain = await getSetting('hostname');
	if (!baseDomain) {
		return { success: false, error: 'No hostname configured' };
	}

	/* Check for existing preview for this PR - update it instead of creating new */
	const existing = await db
		.select()
		.from(previewDeployments)
		.where(
			and(
				eq(previewDeployments.projectId, project.id),
				eq(previewDeployments.prNumber, prNumber),
				eq(previewDeployments.status, 'active')
			)
		)
		.limit(1);

	let port: number;
	let previewId: string;
	const domain = buildPreviewDomain(prNumber, project.slug, baseDomain);
	const containerName = `${project.slug}-pr-${prNumber}`;

	if (existing.length > 0) {
		/* Reuse existing preview's port and update */
		const prev = existing[0];
		port = prev.port!;
		previewId = prev.id;

		await db
			.update(previewDeployments)
			.set({
				commitSha,
				prTitle,
				status: 'building',
				updatedAt: new Date().toISOString()
			})
			.where(eq(previewDeployments.id, previewId));
	} else {
		/* Enforce limit before creating new preview */
		await enforcePreviewLimit(project.id, project.previewLimit);

		port = await allocatePreviewPort();
		const record = await db
			.insert(previewDeployments)
			.values({
				projectId: project.id,
				prNumber,
				prTitle,
				branch,
				commitSha,
				containerName,
				port,
				domain,
				status: 'building'
			})
			.returning();

		previewId = record[0].id;
	}

	/* Trigger the pipeline (fire-and-forget) */
	runPipeline(
		{
			projectId: project.id,
			projectSlug: containerName,
			repoUrl: project.repoUrl,
			branch,
			port,
			domain,
			frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
			tier: (project.tier as Tier) ?? undefined
		},
		createCommandRunner()
	)
		.then(async (result) => {
			await db
				.update(previewDeployments)
				.set({
					status: result.success ? 'active' : 'failed',
					deploymentId: result.deploymentId,
					commitSha: result.commitSha ?? commitSha,
					updatedAt: new Date().toISOString()
				})
				.where(eq(previewDeployments.id, previewId));
		})
		.catch(async () => {
			await db
				.update(previewDeployments)
				.set({ status: 'failed', updatedAt: new Date().toISOString() })
				.where(eq(previewDeployments.id, previewId));
		});

	return { success: true, previewId, domain, port };
}

/**
 * Clean up a preview deployment: stop container, remove Caddy route, mark as cleaned.
 */
export async function cleanupPreview(previewId: string, caddy?: CaddyClient): Promise<void> {
	const rows = await db
		.select()
		.from(previewDeployments)
		.where(eq(previewDeployments.id, previewId))
		.limit(1);

	if (rows.length === 0) return;

	const preview = rows[0];
	const runner = createCommandRunner();
	const caddyClient = caddy ?? new CaddyClient();

	/* Stop the container */
	if (preview.containerName) {
		await dockerStop(runner, preview.containerName, 10).catch(() => {});
	}

	/* Remove Caddy route */
	if (preview.domain) {
		await caddyClient.removeRoute(preview.domain).catch(() => {});
	}

	/* Mark deployment as stopped if exists */
	if (preview.deploymentId) {
		await db
			.update(deployments)
			.set({ status: 'stopped', finishedAt: new Date().toISOString() })
			.where(eq(deployments.id, preview.deploymentId))
			.catch(() => {});
	}

	/* Mark preview as cleaned */
	await db
		.update(previewDeployments)
		.set({ status: 'cleaned', updatedAt: new Date().toISOString() })
		.where(eq(previewDeployments.id, previewId));
}

/**
 * Clean up all previews for a specific PR (when closed or merged).
 */
export async function cleanupPrPreviews(
	projectId: string,
	prNumber: number,
	caddy?: CaddyClient
): Promise<number> {
	const active = await db
		.select()
		.from(previewDeployments)
		.where(
			and(
				eq(previewDeployments.projectId, projectId),
				eq(previewDeployments.prNumber, prNumber),
				eq(previewDeployments.status, 'active')
			)
		);

	for (const preview of active) {
		await cleanupPreview(preview.id, caddy);
	}

	/* Also clean up building ones */
	const building = await db
		.select()
		.from(previewDeployments)
		.where(
			and(
				eq(previewDeployments.projectId, projectId),
				eq(previewDeployments.prNumber, prNumber),
				eq(previewDeployments.status, 'building')
			)
		);

	for (const preview of building) {
		await db
			.update(previewDeployments)
			.set({ status: 'cleaned', updatedAt: new Date().toISOString() })
			.where(eq(previewDeployments.id, preview.id));
	}

	return active.length + building.length;
}

/**
 * Enforce the preview limit for a project.
 * Removes oldest active previews when the limit would be exceeded.
 */
export async function enforcePreviewLimit(projectId: string, limit: number): Promise<void> {
	const active = await db
		.select()
		.from(previewDeployments)
		.where(
			and(eq(previewDeployments.projectId, projectId), eq(previewDeployments.status, 'active'))
		)
		.orderBy(asc(previewDeployments.createdAt));

	/* Remove oldest if at or above limit (making room for one more) */
	const toRemove = active.length - limit + 1;
	if (toRemove > 0) {
		for (let i = 0; i < toRemove; i++) {
			await cleanupPreview(active[i].id);
		}
	}
}

/**
 * List active previews for a project.
 */
export async function listPreviews(projectId: string) {
	return db
		.select()
		.from(previewDeployments)
		.where(
			and(eq(previewDeployments.projectId, projectId), eq(previewDeployments.status, 'active'))
		)
		.orderBy(asc(previewDeployments.createdAt));
}
