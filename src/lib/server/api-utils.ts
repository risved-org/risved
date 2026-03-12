import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Require an authenticated user on the request. Throws 401 if not authenticated.
 */
export function requireAuth(event: RequestEvent): App.Locals['user'] {
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}
	return event.locals.user;
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
