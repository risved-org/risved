import { CaddyClient } from './index'
import { getSetting } from '$lib/server/settings'

const CONTROL_PLANE_PORT = 3000

interface DomainConfig {
	mode: 'subdomain' | 'dedicated' | 'ip'
	baseDomain: string
	prefix: string
}

/**
 * Configure Caddy route for the control plane dashboard.
 * Reads domain_config from settings and adds the dashboard route.
 * App routes are added individually by the deploy pipeline.
 * Safe to call multiple times — routes are replaced if they already exist.
 */
export async function ensureControlPlaneRoutes(caddy?: CaddyClient): Promise<void> {
	const raw = await getSetting('domain_config')
	if (!raw) return

	let config: DomainConfig
	try {
		config = JSON.parse(raw)
	} catch {
		return
	}

	if (config.mode === 'ip' || !config.baseDomain) return

	const client = caddy ?? new CaddyClient()

	const ensured = await client.ensureServer()
	if (!ensured.success) {
		console.error('[caddy] Failed to ensure server:', ensured.error)
		return
	}

	const dashboardHostname = config.mode === 'subdomain'
		? `${config.prefix}.${config.baseDomain}`
		: config.baseDomain

	const dashResult = await client.addRoute({
		hostname: dashboardHostname,
		port: CONTROL_PLANE_PORT
	})
	if (!dashResult.success) {
		console.error(`[caddy] Failed to add dashboard route (${dashboardHostname}):`, dashResult.error)
	}
}
