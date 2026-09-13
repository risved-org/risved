import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { db } from '$lib/server/db';
import { projects, deployments } from '$lib/server/db/schema';
import { count, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where to send the user after signing in.
 *
 * The MCP OAuth flow parks an unauthenticated client here with the original
 * authorize query still attached; signing in has to hand that query back to
 * BetterAuth's authorize endpoint or the waiting agent never gets its code.
 * Only the query is carried over — the path is ours — so this can't be turned
 * into an open redirect.
 */
export function _resolvePostLogin(url: URL): string {
	if (!url.searchParams.get('client_id') || !url.searchParams.get('redirect_uri')) return '/';
	return `/api/auth/mcp/authorize?${url.searchParams.toString()}`;
}

export const load = (async (event) => {
	if (event.locals.user) {
		redirect(302, _resolvePostLogin(event.url));
	}

	const [projectCount] = await db.select({ count: count() }).from(projects);
	const [runningCount] = await db
		.select({ count: count() })
		.from(deployments)
		.where(eq(deployments.status, 'live'));

	return {
		projectCount: projectCount.count,
		runningCount: runningCount.count,
		/* '/' unless an MCP client is waiting on the OAuth flow. */
		postLogin: _resolvePostLogin(event.url)
	};
}) satisfies PageServerLoad;

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

		redirect(302, _resolvePostLogin(event.url));
	}
};
