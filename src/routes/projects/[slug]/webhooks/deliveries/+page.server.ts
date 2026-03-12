import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, webhookDeliveries } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params;

	const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
	if (rows.length === 0) {
		error(404, 'Project not found');
	}

	const project = rows[0];

	const deliveries = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.projectId, project.id))
		.orderBy(desc(webhookDeliveries.createdAt))
		.limit(50);

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug
		},
		deliveries: deliveries.map((d) => ({
			id: d.id,
			event: d.event,
			signatureValid: d.signatureValid,
			actionTaken: d.actionTaken,
			createdAt: d.createdAt
		}))
	};
};
