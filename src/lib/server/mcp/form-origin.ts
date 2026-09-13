const FORM_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
])
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Proposed form-origin policy. Not connected to the request pipeline pending approval. */
export function rejectsCrossSiteForm(request: Request, url: URL): boolean {
	if (url.pathname === '/api/auth/mcp/token' && request.method === 'POST') return false
	const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
	return (
		MUTATIONS.has(request.method) &&
		FORM_TYPES.has(contentType) &&
		request.headers.get('origin') !== url.origin
	)
}
