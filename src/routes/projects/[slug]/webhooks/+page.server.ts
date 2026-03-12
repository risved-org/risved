import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateWebhookSecret } from '$lib/server/api-utils';
import { getSetting } from '$lib/server/settings';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params;

	const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
	if (rows.length === 0) {
		error(404, 'Project not found');
	}

	const project = rows[0];
	const risvedDomain = (await getSetting('domain')) ?? 'localhost:5173';

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug,
			branch: project.branch,
			webhookSecret: project.webhookSecret,
			webhookPushEnabled: project.webhookPushEnabled,
			webhookPrMergedEnabled: project.webhookPrMergedEnabled
		},
		payloadUrl: `https://${risvedDomain}/api/webhooks/${project.id}`,
		risvedDomain
	};
};

export const actions: Actions = {
	regenerate: async ({ params }) => {
		const { slug } = params;
		const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (rows.length === 0) return fail(404, { error: 'Project not found' });

		const newSecret = generateWebhookSecret();
		await db
			.update(projects)
			.set({ webhookSecret: newSecret, updatedAt: new Date().toISOString() })
			.where(eq(projects.id, rows[0].id));

		return { regenerated: true };
	},

	update: async ({ params, request }) => {
		const { slug } = params;
		const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (rows.length === 0) return fail(404, { error: 'Project not found' });

		const form = await request.formData();
		const branch = (form.get('branch') as string)?.trim() || 'main';
		const pushEnabled = form.get('webhookPushEnabled') === 'on';
		const prMergedEnabled = form.get('webhookPrMergedEnabled') === 'on';

		await db
			.update(projects)
			.set({
				branch,
				webhookPushEnabled: pushEnabled,
				webhookPrMergedEnabled: prMergedEnabled,
				updatedAt: new Date().toISOString()
			})
			.where(eq(projects.id, rows[0].id));

		return { updated: true };
	}
};
