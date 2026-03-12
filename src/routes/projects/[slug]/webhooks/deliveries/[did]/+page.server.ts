import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, webhookDeliveries } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifySignature, parseWebhookPayload } from '$lib/server/webhook';
import { runPipeline } from '$lib/server/pipeline';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import type { FrameworkId, Tier } from '$lib/server/detection/types';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { slug, did } = params;

	const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
	if (rows.length === 0) {
		error(404, 'Project not found');
	}

	const project = rows[0];

	const deliveryRows = await db
		.select()
		.from(webhookDeliveries)
		.where(and(eq(webhookDeliveries.id, did), eq(webhookDeliveries.projectId, project.id)))
		.limit(1);

	if (deliveryRows.length === 0) {
		error(404, 'Delivery not found');
	}

	const delivery = deliveryRows[0];

	let headers: Record<string, string> = {};
	try {
		headers = JSON.parse(delivery.headers);
	} catch {
		/* best effort */
	}

	let payload: unknown = null;
	try {
		payload = JSON.parse(delivery.payload);
	} catch {
		payload = delivery.payload;
	}

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug
		},
		delivery: {
			id: delivery.id,
			event: delivery.event,
			signatureValid: delivery.signatureValid,
			actionTaken: delivery.actionTaken,
			createdAt: delivery.createdAt,
			headers,
			payload
		}
	};
};

export const actions: Actions = {
	redeliver: async ({ params }) => {
		const { slug, did } = params;

		const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (rows.length === 0) {
			error(404, 'Project not found');
		}

		const project = rows[0];

		const deliveryRows = await db
			.select()
			.from(webhookDeliveries)
			.where(and(eq(webhookDeliveries.id, did), eq(webhookDeliveries.projectId, project.id)))
			.limit(1);

		if (deliveryRows.length === 0) {
			error(404, 'Delivery not found');
		}

		const delivery = deliveryRows[0];

		let headers: Record<string, string> = {};
		try {
			headers = JSON.parse(delivery.headers);
		} catch {
			/* best effort */
		}

		let body: Record<string, unknown> = {};
		try {
			body = JSON.parse(delivery.payload);
		} catch {
			/* best effort */
		}

		/* Verify signature against current secret */
		const signatureValid = project.webhookSecret
			? verifySignature(delivery.payload, project.webhookSecret, headers)
			: false;

		const webhookEvent = parseWebhookPayload(headers, body);

		/* Log the redelivery */
		const actionTaken = signatureValid ? 'redelivered' : 'rejected: invalid signature';
		await db.insert(webhookDeliveries).values({
			projectId: project.id,
			event: webhookEvent.type,
			headers: delivery.headers,
			payload: delivery.payload,
			signatureValid,
			actionTaken
		});

		/* Trigger deployment if valid */
		if (signatureValid && project.port) {
			runPipeline(
				{
					projectId: project.id,
					projectSlug: project.slug,
					repoUrl: project.repoUrl,
					branch: project.branch,
					port: project.port,
					domain: project.domain ?? undefined,
					frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
					tier: (project.tier as Tier) ?? undefined
				},
				createCommandRunner()
			).catch(() => {
				/* Pipeline errors are logged internally */
			});
		}

		return { redelivered: true, signatureValid };
	}
};
