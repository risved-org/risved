import { CaddyClient, routeId } from './index'
import { getSetting } from '$lib/server/settings'
import { db } from '$lib/server/db'
import { projects, deployments, domains } from '$lib/server/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'

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

/**
 * Restore all Caddy routes from the database.
 * Checks the running Caddy config first — only pushes routes that are missing.
 * Covers the control plane route, project primary domains, and custom domains
 * for every project that has a live deployment with a known port.
 * Called on startup so a Caddy restart never leaves apps unreachable.
 */
export async function restoreAllRoutes(caddy?: CaddyClient): Promise<void> {
	const client = caddy ?? new CaddyClient()

	/* Ensure the base server structure exists */
	const ensured = await client.ensureServer()
	if (!ensured.success) {
		console.error('[caddy] Failed to ensure server:', ensured.error)
		return
	}

	/* Snapshot existing routes so we only push what's missing */
	const existingRoutes = await client.listRoutes()
	const existingIds = new Set(
		existingRoutes.map(r => r['@id']).filter(Boolean)
	)

	/**
	 * Add a route only if its @id is not already present in Caddy.
	 * Returns true if the route was added, false if skipped or failed.
	 */
	async function addIfMissing(hostname: string, port: number): Promise<boolean> {
		const id = routeId(hostname)
		if (existingIds.has(id)) return false
		const result = await client.addRoute({ hostname, port })
		if (!result.success) {
			console.error(`[caddy] Failed to restore route ${hostname}:`, result.error)
			return false
		}
		return true
	}

	let restored = 0

	/* Control plane / dashboard route */
	const raw = await getSetting('domain_config')
	if (raw) {
		try {
			const config: DomainConfig = JSON.parse(raw)
			if (config.mode !== 'ip' && config.baseDomain) {
				const dashboardHostname = config.mode === 'subdomain'
					? `${config.prefix}.${config.baseDomain}`
					: config.baseDomain
				if (await addIfMissing(dashboardHostname, CONTROL_PLANE_PORT)) restored++
			}
		} catch { /* invalid config, skip */ }
	}

	/* Find all projects that have a port and a primary domain */
	const liveProjects = await db
		.select({
			id: projects.id,
			domain: projects.domain,
			port: projects.port
		})
		.from(projects)
		.where(and(isNotNull(projects.port), isNotNull(projects.domain)))

	/* Filter to only projects with a live deployment */
	const liveProjectIds = new Set<string>()
	for (const p of liveProjects) {
		const live = await db
			.select({ id: deployments.id })
			.from(deployments)
			.where(and(eq(deployments.projectId, p.id), eq(deployments.status, 'live')))
			.limit(1)
		if (live.length > 0) {
			liveProjectIds.add(p.id)
		}
	}

	/* Re-add primary domain routes */
	const portByProjectId = new Map<string, number>()
	for (const p of liveProjects) {
		if (!liveProjectIds.has(p.id) || !p.port || !p.domain) continue
		portByProjectId.set(p.id, p.port)
		if (await addIfMissing(p.domain, p.port)) restored++
	}

	/* Re-add custom domain routes */
	const customDomains = await db
		.select({
			hostname: domains.hostname,
			projectId: domains.projectId
		})
		.from(domains)

	for (const d of customDomains) {
		const port = portByProjectId.get(d.projectId)
		if (!port) continue
		if (await addIfMissing(d.hostname, port)) restored++
	}

	if (restored > 0) {
		console.log(`[caddy] Restored ${restored} route(s) on startup`)
	} else {
		console.log('[caddy] All routes already present, nothing to restore')
	}
}
