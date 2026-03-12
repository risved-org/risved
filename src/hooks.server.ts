import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { isFirstRun } from '$lib/server/auth-utils';
import { isOnboardingComplete } from '$lib/server/settings';
import { getHealthMonitor } from '$lib/server/health';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';

/* Start health monitor on server boot (not during build) */
if (!building) {
	getHealthMonitor().start();
}

const PUBLIC_PATHS = ['/onboarding', '/login', '/api/auth', '/api/webhooks'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

/**
 * Redirects to onboarding if no admin user exists (first-run) or onboarding is incomplete.
 * Protects dashboard/API routes by requiring a valid session.
 */
const handleAuth: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (building) return resolve(event);

	const firstRun = await isFirstRun();
	const onboardingDone = await isOnboardingComplete();

	if (firstRun && !isPublicPath(pathname)) {
		redirect(303, '/onboarding');
	}

	if (!firstRun && !onboardingDone && !isPublicPath(pathname)) {
		redirect(303, '/onboarding/domain');
	}

	if (onboardingDone && pathname.startsWith('/onboarding')) {
		redirect(303, '/');
	}

	if (!isPublicPath(pathname) && !event.locals.user) {
		redirect(303, '/login');
	}

	return resolve(event);
};

export const handle: Handle = sequence(handleParaglide, handleBetterAuth, handleAuth);
