import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getSetting } from '$lib/server/settings';

/**
 * Require an authenticated user on the request.
 * Supports both session auth (via event.locals.user) and Bearer token auth
 * using the API token stored in settings.
 * Throws 401 if not authenticated.
 */
export async function requireAuth(
	event: RequestEvent
): Promise<NonNullable<App.Locals['user']>> {
	if (event.locals.user) {
		return event.locals.user;
	}

	/* Check for Bearer token authentication */
	const authHeader = event.request.headers.get('authorization');
	if (authHeader?.startsWith('Bearer ')) {
		const token = authHeader.slice(7);
		const storedToken = await getSetting('api_token');
		if (storedToken && token === storedToken) {
			/* Token-authenticated requests get a synthetic user identity */
			return { id: 'api-token', email: 'api@risved.local', name: 'API' } as NonNullable<
				App.Locals['user']
			>;
		}
	}

	error(401, 'Authentication required');
}

/**
 * Generate a slug from a project name.
 * Lowercase, replace non-alphanumeric with hyphens, trim hyphens.
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
}

/**
 * Generate a random webhook secret.
 */
export function generateWebhookSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Return a JSON error response.
 */
export function jsonError(status: number, message: string) {
	return json({ error: message }, { status });
}
