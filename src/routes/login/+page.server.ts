import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { db } from '$lib/server/db';
import { projects, deployments } from '$lib/server/db/schema';
import { count, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		redirect(302, '/');
	}

	const [projectCount] = await db.select({ count: count() }).from(projects);
	const [runningCount] = await db
		.select({ count: count() })
		.from(deployments)
		.where(eq(deployments.status, 'live'));

	return {
		projectCount: projectCount.count,
		runningCount: runningCount.count
	};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		try {
			await auth.api.signInEmail({
				body: { email, password }
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { email, error: error.message || 'Invalid email or password' });
			}
			return fail(500, { email, error: 'An unexpected error occurred' });
		}

		redirect(302, '/');
	}
};
