import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
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
			previewsEnabled: project.previewsEnabled,
			previewLimit: project.previewLimit,
			previewAutoDelete: project.previewAutoDelete,
			commitStatusEnabled: project.commitStatusEnabled,
			requiredCheck: project.requiredCheck
		},
		risvedDomain,
		previewUrlFormat: `pr-{number}.${project.slug}.${risvedDomain}`
	};
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		const { slug } = params;
		const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (rows.length === 0) return fail(404, { error: 'Project not found' });

		const form = await request.formData();
		const previewsEnabled = form.get('previewsEnabled') === 'on';
		const previewAutoDelete = form.get('previewAutoDelete') === 'on';
		const commitStatusEnabled = form.get('commitStatusEnabled') === 'on';
		const requiredCheck = form.get('requiredCheck') === 'on';
		const previewLimitRaw = parseInt(form.get('previewLimit') as string, 10);
		const previewLimit =
			Number.isFinite(previewLimitRaw) && previewLimitRaw >= 1 ? previewLimitRaw : 3;

		await db
			.update(projects)
			.set({
				previewsEnabled,
				previewAutoDelete,
				commitStatusEnabled,
				requiredCheck,
				previewLimit,
				updatedAt: new Date().toISOString()
			})
			.where(eq(projects.id, rows[0].id));

		return { saved: true };
	}
};
