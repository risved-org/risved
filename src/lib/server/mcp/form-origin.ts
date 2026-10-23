import { dev } from '$app/environment'
import type { Handle } from '@sveltejs/kit'

const FORM_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
])
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Preserve SvelteKit's form-origin policy except for the non-cookie OAuth token exchange. */
export function rejectsCrossSiteForm(request: Request, url: URL): boolean {
	if (url.pathname === '/api/auth/mcp/token' && request.method === 'POST') return false
	const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
	return (
		MUTATIONS.has(request.method) &&
		FORM_TYPES.has(contentType) &&
		request.headers.get('origin') !== url.origin
	)
}

/** Must remain first in hooks.server.ts: this replaces the disabled framework form guard. */
export const handleFormOrigin: Handle = ({ event, resolve }) => {
	if (!dev && rejectsCrossSiteForm(event.request, event.url)) {
		const message = `Cross-site ${event.request.method} form submissions are forbidden`
		return event.request.headers.get('accept') === 'application/json'
			? Response.json({ message }, { status: 403 })
			: new Response(message, { status: 403 })
	}
	return resolve(event)
}
