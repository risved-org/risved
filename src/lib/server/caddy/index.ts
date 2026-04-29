import type {
	CaddyClientConfig,
	CaddyHealthStatus,
	CaddyResult,
	CaddyRoute,
	CaddyRouteConfig,
	FetchFn
} from './types';

export type { CaddyClientConfig, CaddyHealthStatus, CaddyResult, CaddyRoute } from './types';

const DEFAULT_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://localhost:2019';

/**
 * Build a Caddy route ID from a hostname.
 * Used as the @id field so routes can be addressed individually.
 */
export function routeId(hostname: string): string {
	return `route-${hostname.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

/**
 * Build a Caddy JSON route config for proxying a hostname to a container port.
 */
export function buildRouteConfig(route: CaddyRoute): CaddyRouteConfig {
	return {
		'@id': routeId(route.hostname),
		match: [{ host: [route.hostname] }],
		handle: [
			{
				handler: 'encode',
				encodings: { gzip: {}, zstd: {} },
				prefer: ['zstd', 'gzip']
			},
			{
				handler: 'reverse_proxy',
				upstreams: [{ dial: `localhost:${route.port}` }]
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
		return { 'Content-Type': 'application/json', Origin: this.adminUrl }
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

			/* Config may be null after DELETE — use /load to set entire config */
			const createRes = await this.fetchFn(`${this.adminUrl}/load`, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify({
					apps: {
						http: {
							servers: {
								srv0: {
									listen: [':443'],
									routes: []
								}
							}
						}
					}
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
 * Convenience factory for common usage.
 */
export function createCaddyClient(config?: CaddyClientConfig): CaddyClient {
	return new CaddyClient(config);
}
