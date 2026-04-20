import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, webhookDeliveries } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifySignature, parseWebhookPayload } from '$lib/server/webhook';
import { runPipeline } from '$lib/server/pipeline';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import { createPreview, cleanupPrPreviews } from '$lib/server/preview';
import type { FrameworkId, Tier } from '$lib/server/detection/types';
import type { RequestHandler } from './$types';

/** Simple in-memory rate limiter: max 30 deliveries per project per minute. */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(projectId: string): boolean {
	const now = Date.now();
	const entry = rateLimitMap.get(projectId);

	if (!entry || now > entry.resetAt) {
		rateLimitMap.set(projectId, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return false;
	}

	entry.count++;
	return entry.count > RATE_LIMIT;
}

/**
 * POST /api/webhooks/:projectId — receive webhook payload from git provider.
 * No auth session required — uses HMAC signature verification.
 */
export const POST: RequestHandler = async (event) => {
	const { projectId } = event.params;

	/* Rate limiting */
	if (isRateLimited(projectId)) {
		return json({ error: 'Rate limit exceeded' }, { status: 429 });
	}

	/* Look up project */
	const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
	if (rows.length === 0) {
		return json({ error: 'Project not found' }, { status: 404 });
	}

	const project = rows[0];

	/* Read raw payload */
	const rawPayload = await event.request.text();

	/* Extract headers as lowercase map */
	const headers: Record<string, string> = {};
	event.request.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value;
	});

	/* Verify signature */
	const signatureValid = project.webhookSecret
		? verifySignature(rawPayload, project.webhookSecret, headers)
		: false;

	/* Parse payload */
	let body: Record<string, unknown> = {};
	try {
		body = JSON.parse(rawPayload);
	} catch {
		await logDelivery(projectId, 'parse_error', headers, rawPayload, false, 'invalid JSON');
		return json({ error: 'Invalid JSON payload' }, { status: 400 });
	}

	const webhookEvent = parseWebhookPayload(headers, body);

	/* Log delivery regardless of outcome */
	let actionTaken = 'none';

	if (!signatureValid) {
		actionTaken = 'rejected: invalid signature';
		await logDelivery(projectId, webhookEvent.type, headers, rawPayload, false, actionTaken);
		return json({ error: 'Invalid signature' }, { status: 401 });
	}

	/* Skip unknown events */
	if (webhookEvent.type === 'unknown') {
		actionTaken = 'skipped: unsupported event type';
		await logDelivery(projectId, 'unknown', headers, rawPayload, true, actionTaken);
		return json({ received: true, action: actionTaken });
	}

	/* Handle PR preview events */
	if (webhookEvent.type === 'pr_open' || webhookEvent.type === 'pr_update') {
		return handlePrPreview(project, webhookEvent, headers, rawPayload);
	}

	if (webhookEvent.type === 'pr_close') {
		return handlePrClose(project, webhookEvent, headers, rawPayload);
	}

	/* Branch filter: skip if push branch doesn't match project's deploy branch */
	if (webhookEvent.branch && webhookEvent.branch !== project.branch) {
		actionTaken = `skipped: branch ${webhookEvent.branch} != ${project.branch}`;
		await logDelivery(projectId, webhookEvent.type, headers, rawPayload, true, actionTaken);
		return json({ received: true, action: actionTaken });
	}

	/* Trigger deployment */
	if (!project.port) {
		actionTaken = 'skipped: no port allocated';
		await logDelivery(projectId, webhookEvent.type, headers, rawPayload, true, actionTaken);
		return json({ received: true, action: actionTaken });
	}

	actionTaken = 'triggered deployment';
	await logDelivery(projectId, webhookEvent.type, headers, rawPayload, true, actionTaken);

	/* Fire and forget — don't block the webhook response */
	runPipeline(
		{
			projectId: project.id,
			projectSlug: project.slug,
			repoUrl: project.repoUrl,
			branch: project.branch,
			port: project.port,
			domain: project.domain ?? undefined,
			frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
			tier: (project.tier as Tier) ?? undefined,
			buildCommand: project.buildCommand,
			startCommand: project.startCommand,
			releaseCommand: project.releaseCommand
		},
		createCommandRunner()
	).catch(() => {
		/* Pipeline errors are logged internally */
	});

	return json({ received: true, action: actionTaken, event: webhookEvent.type });
};

/**
 * Handle PR open/update: create or update preview deployment.
 */
async function handlePrPreview(
	project: typeof projects.$inferSelect,
	webhookEvent: ReturnType<typeof parseWebhookPayload>,
	headers: Record<string, string>,
	rawPayload: string
) {
	if (!project.previewsEnabled) {
		const action = 'skipped: previews disabled';
		await logDelivery(project.id, webhookEvent.type, headers, rawPayload, true, action);
		return json({ received: true, action });
	}

	if (!webhookEvent.prNumber) {
		const action = 'skipped: no PR number';
		await logDelivery(project.id, webhookEvent.type, headers, rawPayload, true, action);
		return json({ received: true, action });
	}

	const action = `triggered preview for PR #${webhookEvent.prNumber}`;
	await logDelivery(project.id, webhookEvent.type, headers, rawPayload, true, action);

	createPreview(
		{
			id: project.id,
			slug: project.slug,
			repoUrl: project.repoUrl,
			branch: project.branch,
			frameworkId: project.frameworkId,
			tier: project.tier,
			previewLimit: project.previewLimit,
			previewsEnabled: project.previewsEnabled,
			previewAutoDelete: project.previewAutoDelete,
			releaseCommand: project.releaseCommand
		},
		webhookEvent.prNumber,
		webhookEvent.prTitle,
		webhookEvent.branch ?? 'main',
		webhookEvent.commitSha
	).catch(() => {
		/* Preview errors are logged internally */
	});

	return json({ received: true, action, event: webhookEvent.type });
}

/**
 * Handle PR close: clean up preview deployments if auto-delete is enabled.
 */
async function handlePrClose(
	project: typeof projects.$inferSelect,
	webhookEvent: ReturnType<typeof parseWebhookPayload>,
	headers: Record<string, string>,
	rawPayload: string
) {
	if (!project.previewsEnabled || !project.previewAutoDelete) {
		const action = 'skipped: auto-delete disabled';
		await logDelivery(project.id, webhookEvent.type, headers, rawPayload, true, action);
		return json({ received: true, action });
	}

	if (!webhookEvent.prNumber) {
		const action = 'skipped: no PR number';
		await logDelivery(project.id, webhookEvent.type, headers, rawPayload, true, action);
		return json({ received: true, action });
	}

	const action = `cleaning up preview for PR #${webhookEvent.prNumber}`;
	await logDelivery(project.id, webhookEvent.type, headers, rawPayload, true, action);

	cleanupPrPreviews(project.id, webhookEvent.prNumber).catch(() => {
		/* Cleanup errors are non-fatal */
	});

	return json({ received: true, action, event: webhookEvent.type });
}

/** Log a webhook delivery to the database. */
async function logDelivery(
	projectId: string,
	event: string,
	headers: Record<string, string>,
	payload: string,
	signatureValid: boolean,
	actionTaken: string
): Promise<void> {
	try {
		await db.insert(webhookDeliveries).values({
			projectId,
			event,
			headers: JSON.stringify(headers),
			payload: payload.slice(0, 64_000),
			signatureValid,
			actionTaken
		});
	} catch {
		/* Best-effort logging — don't fail the webhook */
	}
}
