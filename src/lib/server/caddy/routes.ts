import type { CaddyRoute, CaddyRouteConfig, CaddyResult, FetchFn } from './types'

const UPSTREAM_HOST = process.env.CADDY_ADMIN_URL ? 'host.docker.internal' : 'localhost'

/** Keep legacy root IDs, while giving each subpath an unambiguous identity. */
export function routeId(hostname: string, pathPrefix = '/'): string {
	const root = `route-${hostname.replace(/[^a-zA-Z0-9-]/g, '-')}`
	return pathPrefix === '/'
		? root
		: `mount-${Buffer.from(hostname).toString('hex')}-${Buffer.from(pathPrefix).toString('hex')}`
}

/** Match an entire path segment, including the mount point itself. */
function match(hostname: string, prefix: string) {
	return [{ host: [hostname], ...(prefix === '/' ? {} : { path: [prefix, `${prefix}/*`] }) }]
}

/** Use Caddy's native proxy so methods, bodies, queries and upgrades remain intact. */
export function buildRouteConfig(route: CaddyRoute): CaddyRouteConfig {
	const prefix = route.pathPrefix ?? '/'
	return {
		'@id': routeId(route.hostname, prefix),
		match: match(route.hostname, prefix),
		terminal: true,
		handle: [
			{ handler: 'encode', encodings: { gzip: {}, zstd: {} }, prefer: ['zstd', 'gzip'] },
			...(route.forwardingMode === 'strip' && prefix !== '/'
				? [{ handler: 'rewrite' as const, strip_path_prefix: prefix }]
				: []),
			{
				handler: 'reverse_proxy',
				upstreams: [{ dial: `${UPSTREAM_HOST}:${route.port}` }],
				headers: { request: { set: { 'X-Forwarded-Prefix': [prefix] } } }
			}
		]
	}
}

/** Redirect only this mount, preserving the public path and query string. */
export function buildRedirectRouteConfig(from: string, to: string, prefix = '/'): CaddyRouteConfig {
	return {
		'@id': routeId(from, prefix),
		match: match(from, prefix),
		terminal: true,
		handle: [
			{
				handler: 'static_response',
				status_code: '301',
				headers: { Location: [`https://${to}{http.request.uri}`] }
			}
		]
	}
}

/** Atomically replace one mapping and order mounts before their shorter fallbacks. */
export async function replaceRoute(
	fetchFn: FetchFn,
	adminUrl: string,
	headers: Record<string, string>,
	route: CaddyRouteConfig
): Promise<CaddyResult> {
	return mutateRoutes(fetchFn, adminUrl, headers, routes => {
		if (
			route.handle[0]?.handler === 'static_response' &&
			routes.some(
				r => r['@id'] === route['@id'] && (r.handle ?? []).some(h => h.handler === 'reverse_proxy')
			)
		)
			return routes
		const next = routes.filter(r => r['@id'] !== route['@id'])
		next.push(route)
		return next.sort((a, b) => specificity(b) - specificity(a))
	})
}

/** Apply a route-list change conditionally so sibling edits cannot be overwritten. */
export async function mutateRoutes(
	fetchFn: FetchFn,
	adminUrl: string,
	headers: Record<string, string>,
	edit: (routes: CaddyRouteConfig[]) => CaddyRouteConfig[]
): Promise<CaddyResult> {
	const url = `${adminUrl}/config/apps/http/servers/srv0/routes`
	for (let attempt = 0; attempt < 5; attempt++) {
		const current = await fetchFn(url, { headers })
		if (!current.ok) return { success: false, error: `Cannot read routes: ${current.status}` }
		const etag = current.headers.get('etag')
		if (!etag) return { success: false, error: 'Caddy did not provide a route configuration Etag' }
		const routes: CaddyRouteConfig[] = (await current.json()) ?? []
		const res = await fetchFn(url, {
			method: 'PATCH',
			headers: { ...headers, 'If-Match': etag },
			body: JSON.stringify(edit(routes))
		})
		if (res.status === 412) continue
		if (!res.ok) return { success: false, error: `Failed to update route: ${await res.text()}` }
		return { success: true }
	}
	return { success: false, error: 'Caddy routes changed concurrently; retry the operation' }
}

/** Root and legacy host-only routes sort after all path mounts. */
function specificity(route: CaddyRouteConfig): number {
	return Math.max(
		0,
		...(route.match ?? []).flatMap(m => m.path?.map(p => p.replace(/\/\*$/, '').length) ?? [0])
	)
}
