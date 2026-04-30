import type {
	CaddyClientConfig,
	CaddyHeadersHandlerConfig,
	CaddyHealthStatus,
	CaddyResult,
	CaddyRoute,
	CaddyRouteConfig,
	CaddySubrouteHandlerConfig,
	FetchFn
} from './types';

export type { CaddyClientConfig, CaddyHealthStatus, CaddyResult, CaddyRoute } from './types';

/**
 * Platform-wide security headers applied to every proxied response.
 * Values are conservative defaults — apps that need a stricter CSP can
 * still send their own (the deferred set will overwrite). The defaults
 * here exist so a freshly deployed app is never missing the basics.
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'X-Frame-Options': 'SAMEORIGIN',
	'Content-Security-Policy': "frame-ancestors 'self'"
}

/**
 * Path patterns for framework-emitted hashed (immutable) static assets.
 * Files under these paths carry a content hash in their filename, so a
 * year-long immutable cache is safe — a content change produces a new path.
 */
export const HASHED_ASSET_PATHS = [
	'/_app/immutable/*',  /* SvelteKit */
	'/_astro/*',          /* Astro */
	'/_next/static/*',    /* Next.js */
	'/_nuxt/*'            /* Nuxt */
]

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const DEFAULT_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://localhost:2019';
const UPSTREAM_HOST = process.env.CADDY_ADMIN_URL ? 'host.docker.internal' : 'localhost';

/**
 * Build a Caddy route ID from a hostname.
 * Used as the @id field so routes can be addressed individually.
 */
export function routeId(hostname: string): string {
	return `route-${hostname.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

/**
 * Build the Caddy headers handler that sets the platform's default
 * security headers. Deferred so the operations run after the upstream
 * response is generated — apps still get the headers even on 5xx.
 */
export function buildSecurityHeadersHandler(): CaddyHeadersHandlerConfig {
	const set: Record<string, string[]> = {}
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		set[name] = [value]
	}
	return {
		handler: 'headers',
		response: { set, deferred: true }
	}
}

/**
 * Build a subroute that tags responses for hashed static assets with a
 * year-long immutable Cache-Control. The match is path-based so dynamic
 * routes are unaffected — the upstream still controls their caching.
 */
export function buildHashedAssetCacheHandler(): CaddySubrouteHandlerConfig {
	return {
		handler: 'subroute',
		routes: [
			{
				match: [{ path: HASHED_ASSET_PATHS }],
				handle: [
					{
						handler: 'headers',
						response: {
							set: { 'Cache-Control': [IMMUTABLE_CACHE_CONTROL] },
							deferred: true
						}
					}
				]
			}
		]
	}
}

/**
 * Build a Caddy JSON route that 301-redirects one hostname to another.
 * Used for www → non-www redirects. HSTS is set on the redirect so the
 * very first hit teaches the browser to upgrade future requests.
 */
export function buildRedirectRouteConfig(from: string, to: string): CaddyRouteConfig {
	return {
		'@id': routeId(from),
		match: [{ host: [from] }],
		handle: [
			{
				handler: 'static_response',
				status_code: '301',
				headers: {
					Location: [`https://${to}{http.request.uri}`],
					'Strict-Transport-Security': [SECURITY_HEADERS['Strict-Transport-Security']]
				}
			}
		]
	}
}

/**
 * Build a Caddy JSON route config for proxying a hostname to a container port.
 */
export function buildRouteConfig(route: CaddyRoute): CaddyRouteConfig {
	return {
		'@id': routeId(route.hostname),
		match: [{ host: [route.hostname] }],
		handle: [
			buildSecurityHeadersHandler(),
			buildHashedAssetCacheHandler(),
			{
				handler: 'encode',
				encodings: { gzip: {}, zstd: {} },
				prefer: ['zstd', 'gzip']
			},
			{
				handler: 'reverse_proxy',
				upstreams: [{ dial: `${UPSTREAM_HOST}:${route.port}` }]
			}
		]
	};
}

/**
 * Client for managing Caddy reverse proxy routes via its JSON admin API.
 *
 * All configuration is done through the Caddy admin API (localhost:2019),
 * never through Caddyfile. Routes are added/removed dynamically as
 * projects are deployed or deleted.
 */
export class CaddyClient {
	private readonly adminUrl: string;
	private readonly fetchFn: FetchFn;

	constructor(config?: CaddyClientConfig, fetchFn?: FetchFn) {
		this.adminUrl = config?.adminUrl ?? DEFAULT_ADMIN_URL;
		this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
	}

	private headers(): Record<string, string> {
		return { 'Content-Type': 'application/json', Origin: 'http://localhost:2019' }
	}

	/**
	 * Check if Caddy is running and responsive.
	 * Hits the /config/ endpoint which always returns the current config.
	 */
	async health(): Promise<CaddyHealthStatus> {
		try {
			const res = await this.fetchFn(`${this.adminUrl}/config/`, {
				method: 'GET',
				headers: this.headers()
			});
			if (res.ok) {
				return { healthy: true };
			}
			return { healthy: false, error: `HTTP ${res.status}: ${res.statusText}` };
		} catch (err) {
			return {
				healthy: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	}

	/**
	 * Ensure the base server configuration exists.
	 * Creates the apps/http/servers/srv0 structure if not present.
	 */
	async ensureServer(): Promise<CaddyResult> {
		try {
			const res = await this.fetchFn(`${this.adminUrl}/config/apps/http/servers/srv0`, {
				method: 'GET',
				headers: this.headers()
			});

			if (res.ok) {
				return { success: true };
			}

			/* PUT directly to the srv0 path instead of PATCHing /config/.
			   PATCH /config/ triggers a full internal reload that resets the
			   admin listener from 0.0.0.0 back to localhost, breaking
			   cross-container access. PUT to a specific path avoids this. */
			const createRes = await this.fetchFn(`${this.adminUrl}/config/apps/http/servers/srv0`, {
				method: 'PUT',
				headers: this.headers(),
				body: JSON.stringify({
					listen: [':443'],
					routes: []
				})
			});

			if (!createRes.ok) {
				const text = await createRes.text();
				return { success: false, error: `Failed to create server: ${text}` };
			}
			return { success: true };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	}

	/**
	 * Add a route mapping a hostname to a container port.
	 * If a route with the same ID already exists, it is replaced.
	 */
	async addRoute(route: CaddyRoute): Promise<CaddyResult> {
		try {
			const config = buildRouteConfig(route);
			const id = routeId(route.hostname);

			await this.removeRoute(route.hostname);

			const res = await this.fetchFn(`${this.adminUrl}/config/apps/http/servers/srv0/routes`, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(config)
			});

			if (!res.ok) {
				const text = await res.text();
				return { success: false, error: `Failed to add route ${id}: ${text}` };
			}
			return { success: true };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	}

	/**
	 * Remove a route by hostname.
	 * Uses the @id-based path to delete a specific route.
	 */
	async removeRoute(hostname: string): Promise<CaddyResult> {
		try {
			const id = routeId(hostname);
			const res = await this.fetchFn(`${this.adminUrl}/id/${id}`, {
				method: 'DELETE',
				headers: this.headers()
			});

			if (res.ok || res.status === 404) {
				return { success: true };
			}

			const text = await res.text();
			return { success: false, error: `Failed to remove route ${id}: ${text}` };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	}

	/**
	 * Add a 301 redirect route (e.g. www → non-www).
	 */
	async addRedirectRoute(from: string, to: string): Promise<CaddyResult> {
		try {
			const config = buildRedirectRouteConfig(from, to)
			await this.removeRoute(from)

			const res = await this.fetchFn(`${this.adminUrl}/config/apps/http/servers/srv0/routes`, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(config)
			})

			if (!res.ok) {
				const text = await res.text()
				return { success: false, error: `Failed to add redirect route: ${text}` }
			}
			return { success: true }
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			}
		}
	}

	/**
	 * Add a wildcard route for automatic app subdomains.
	 * Maps *.<domain> to a container port.
	 */
	async addWildcardRoute(domain: string, port: number): Promise<CaddyResult> {
		return this.addRoute({ hostname: `*.${domain}`, port });
	}

	/**
	 * Remove a wildcard route for a domain.
	 */
	async removeWildcardRoute(domain: string): Promise<CaddyResult> {
		return this.removeRoute(`*.${domain}`);
	}

	/**
	 * List all currently configured routes.
	 * Returns parsed route configs from the srv0 server.
	 */
	async listRoutes(): Promise<CaddyRouteConfig[]> {
		try {
			const res = await this.fetchFn(`${this.adminUrl}/config/apps/http/servers/srv0/routes`, {
				method: 'GET',
				headers: this.headers()
			});

			if (!res.ok) {
				return [];
			}

			const data = await res.json();
			return Array.isArray(data) ? data : [];
		} catch {
			return [];
		}
	}

	/**
	 * Update an existing route's upstream port.
	 * Removes and re-adds the route with the new port.
	 */
	async updateRoute(hostname: string, newPort: number): Promise<CaddyResult> {
		return this.addRoute({ hostname, port: newPort });
	}
}

/**
 * Create a CaddyClient with default configuration.
 */
export function createCaddyClient(config?: CaddyClientConfig): CaddyClient {
	return new CaddyClient(config);
}
