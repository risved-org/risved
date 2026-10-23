import type {
	CaddyClientConfig,
	CaddyHealthStatus,
	CaddyResult,
	CaddyRoute,
	CaddyRouteConfig,
	FetchFn
} from './types'

export type { CaddyClientConfig, CaddyHealthStatus, CaddyResult, CaddyRoute } from './types'

const DEFAULT_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://localhost:2019'

export { routeId, buildRouteConfig, buildRedirectRouteConfig } from './routes'
import {
	routeId,
	buildRouteConfig,
	buildRedirectRouteConfig,
	replaceRoute,
	mutateRoutes
} from './routes'

/**
 * Client for managing Caddy reverse proxy routes via its JSON admin API.
 *
 * All configuration is done through the Caddy admin API (localhost:2019),
 * never through Caddyfile. Routes are added/removed dynamically as
 * projects are deployed or deleted.
 */
export class CaddyClient {
	private readonly adminUrl: string
	private readonly fetchFn: FetchFn

	constructor(config?: CaddyClientConfig, fetchFn?: FetchFn) {
		this.adminUrl = config?.adminUrl ?? DEFAULT_ADMIN_URL
		this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis)
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
			})
			if (res.ok) {
				return { healthy: true }
			}
			return { healthy: false, error: `HTTP ${res.status}: ${res.statusText}` }
		} catch (err) {
			return {
				healthy: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			}
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
			})

			if (res.ok) {
				const existing = await res.json().catch(() => null)
				if (existing && typeof existing === 'object') {
					return { success: true }
				}
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
			})

			if (!createRes.ok) {
				const text = await createRes.text()
				return { success: false, error: `Failed to create server: ${text}` }
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
	 * Add a route mapping a hostname to a container port.
	 * If a route with the same ID already exists, it is replaced.
	 */
	async addRoute(route: CaddyRoute): Promise<CaddyResult> {
		try {
			return await replaceRoute(
				this.fetchFn,
				this.adminUrl,
				this.headers(),
				buildRouteConfig(route)
			)
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			}
		}
	}

	/**
	 * Remove a route by hostname.
	 * Uses the @id-based path to delete a specific route.
	 */
	async removeRoute(hostname: string, pathPrefix = '/'): Promise<CaddyResult> {
		try {
			const id = routeId(hostname, pathPrefix)
			const res = await this.fetchFn(`${this.adminUrl}/id/${id}`, {
				method: 'DELETE',
				headers: this.headers()
			})

			if (res.ok || res.status === 404) {
				return { success: true }
			}

			const text = await res.text()
			return { success: false, error: `Failed to remove route ${id}: ${text}` }
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error'
			}
		}
	}

	/**
	 * Add a 301 redirect route (e.g. www → non-www).
	 */
	async addRedirectRoute(from: string, to: string, pathPrefix = '/'): Promise<CaddyResult> {
		try {
			return await replaceRoute(
				this.fetchFn,
				this.adminUrl,
				this.headers(),
				buildRedirectRouteConfig(from, to, pathPrefix)
			)
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
		}
	}

	/** Remove an automatically generated redirect without deleting an explicit app mapping. */
	async removeRedirectRoute(hostname: string, pathPrefix = '/'): Promise<CaddyResult> {
		try {
			return await mutateRoutes(this.fetchFn, this.adminUrl, this.headers(), routes =>
				routes.filter(
					r =>
						!(
							r['@id'] === routeId(hostname, pathPrefix) &&
							r.handle.some(h => h.handler === 'static_response')
						)
				)
			)
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
		}
	}

	/**
	 * Add a wildcard route for automatic app subdomains.
	 * Maps *.<domain> to a container port.
	 */
	async addWildcardRoute(domain: string, port: number): Promise<CaddyResult> {
		return this.addRoute({ hostname: `*.${domain}`, port })
	}

	/**
	 * Remove a wildcard route for a domain.
	 */
	async removeWildcardRoute(domain: string): Promise<CaddyResult> {
		return this.removeRoute(`*.${domain}`)
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
			})

			if (!res.ok) {
				return []
			}

			const data = await res.json()
			return Array.isArray(data) ? data : []
		} catch {
			return []
		}
	}

	/**
	 * Update an existing route's upstream port.
	 * Removes and re-adds the route with the new port.
	 */
	async updateRoute(
		hostname: string,
		newPort: number,
		pathPrefix = '/',
		forwardingMode: 'preserve' | 'strip' = 'preserve'
	): Promise<CaddyResult> {
		return this.addRoute({ hostname, port: newPort, pathPrefix, forwardingMode })
	}
}

/**
 * Create a CaddyClient with default configuration.
 */
export function createCaddyClient(config?: CaddyClientConfig): CaddyClient {
	return new CaddyClient(config)
}
