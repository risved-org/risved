import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))

vi.mock('$env/dynamic/private', () => ({
	env: { DATABASE_URL: 'file:test.db' }
}))

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn() }
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	domains: 'domains_table'
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((...args: unknown[]) => ['eq', ...args]),
	and: vi.fn((...args: unknown[]) => ['and', ...args]),
	isNotNull: vi.fn((col: unknown) => ['isNotNull', col])
}))

import { getSetting } from '$lib/server/settings'
import { db } from '$lib/server/db'
import { CaddyClient } from './index'
import { ensureControlPlaneRoutes, restoreAllRoutes } from './control-plane'

const mockGetSetting = vi.mocked(getSetting)

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>
}

function mockCaddy(existingRouteIds: string[] = []) {
	return {
		ensureServer: vi.fn().mockResolvedValue({ success: true }),
		addRoute: vi.fn().mockResolvedValue({ success: true }),
		removeRoute: vi.fn().mockResolvedValue({ success: true }),
		listRoutes: vi.fn().mockResolvedValue(
			existingRouteIds.map(id => ({ '@id': id }))
		)
	} as unknown as CaddyClient
}

beforeEach(() => {
	vi.clearAllMocks()
})

/* ── ensureControlPlaneRoutes ─────────────────────────────────────── */

describe('ensureControlPlaneRoutes', () => {
	it('does nothing when no domain_config setting', async () => {
		mockGetSetting.mockResolvedValue(null)
		const caddy = mockCaddy()
		await ensureControlPlaneRoutes(caddy)
		expect(caddy.addRoute).not.toHaveBeenCalled()
	})

	it('does nothing in ip mode', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({ mode: 'ip', baseDomain: '', prefix: '' }))
		const caddy = mockCaddy()
		await ensureControlPlaneRoutes(caddy)
		expect(caddy.addRoute).not.toHaveBeenCalled()
	})

	it('adds subdomain route for dashboard', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({
			mode: 'subdomain',
			baseDomain: 'risved.example.eu',
			prefix: 'dash'
		}))
		const caddy = mockCaddy()
		await ensureControlPlaneRoutes(caddy)
		expect(caddy.ensureServer).toHaveBeenCalled()
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'dash.risved.example.eu',
			port: 3000
		})
	})

	it('adds dedicated domain route for dashboard', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({
			mode: 'dedicated',
			baseDomain: 'panel.example.com',
			prefix: ''
		}))
		const caddy = mockCaddy()
		await ensureControlPlaneRoutes(caddy)
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'panel.example.com',
			port: 3000
		})
	})
})

/* ── restoreAllRoutes ─────────────────────────────────────────────── */

describe('restoreAllRoutes', () => {
	function setupDbForRestore(
		projectRows: { id: string, domain: string, port: number }[],
		liveProjectIds: string[],
		customDomainRows: { hostname: string, projectId: string }[] = []
	) {
		const liveSet = new Set(liveProjectIds)
		const calls: ReturnType<typeof vi.fn>[] = []

		/* projects with domain+port */
		calls.push(
			mockDb.select.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue(projectRows)
				})
			})
		)

		/* live deployment checks — one per project */
		for (const p of projectRows) {
			mockDb.select.mockReturnValueOnce({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue(
							liveSet.has(p.id) ? [{ id: `dep-${p.id}` }] : []
						)
					})
				})
			})
		}

		/* custom domains */
		mockDb.select.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue(customDomainRows)
		})
	}

	it('restores project primary domains and custom domains', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({
			mode: 'subdomain',
			baseDomain: 'risved.example.eu',
			prefix: 'dash'
		}))

		const caddy = mockCaddy() /* no existing routes */

		setupDbForRestore(
			[
				{ id: 'p-1', domain: 'app.example.com', port: 4001 },
				{ id: 'p-2', domain: 'other.example.com', port: 4002 }
			],
			['p-1'], /* only p-1 is live */
			[
				{ hostname: 'custom.example.com', projectId: 'p-1' },
				{ hostname: 'orphan.example.com', projectId: 'p-3' }
			]
		)

		await restoreAllRoutes(caddy)

		/* Dashboard route */
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'dash.risved.example.eu',
			port: 3000
		})

		/* p-1 primary domain (live) */
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'app.example.com',
			port: 4001
		})

		/* p-2 should NOT be routed (no live deployment) */
		expect(caddy.addRoute).not.toHaveBeenCalledWith(
			expect.objectContaining({ hostname: 'other.example.com' })
		)

		/* custom domain for p-1 */
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'custom.example.com',
			port: 4001
		})

		/* orphan domain (project p-3 has no port/live) should NOT be routed */
		expect(caddy.addRoute).not.toHaveBeenCalledWith(
			expect.objectContaining({ hostname: 'orphan.example.com' })
		)
	})

	it('skips routes that already exist in Caddy', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({
			mode: 'subdomain',
			baseDomain: 'risved.example.eu',
			prefix: 'dash'
		}))

		/* Dashboard and app.example.com already exist in Caddy */
		const caddy = mockCaddy([
			'route-dash-risved-example-eu',
			'route-app-example-com'
		])

		setupDbForRestore(
			[
				{ id: 'p-1', domain: 'app.example.com', port: 4001 },
				{ id: 'p-2', domain: 'new-app.example.com', port: 4002 }
			],
			['p-1', 'p-2'],
			[{ hostname: 'custom.example.com', projectId: 'p-1' }]
		)

		await restoreAllRoutes(caddy)

		/* Dashboard should be skipped (already exists) */
		expect(caddy.addRoute).not.toHaveBeenCalledWith(
			expect.objectContaining({ hostname: 'dash.risved.example.eu' })
		)

		/* app.example.com should be skipped (already exists) */
		expect(caddy.addRoute).not.toHaveBeenCalledWith(
			expect.objectContaining({ hostname: 'app.example.com' })
		)

		/* new-app.example.com should be added (missing) */
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'new-app.example.com',
			port: 4002
		})

		/* custom domain should be added (missing) */
		expect(caddy.addRoute).toHaveBeenCalledWith({
			hostname: 'custom.example.com',
			port: 4001
		})
	})

	it('does nothing when all routes already present', async () => {
		mockGetSetting.mockResolvedValue(JSON.stringify({
			mode: 'subdomain',
			baseDomain: 'risved.example.eu',
			prefix: 'dash'
		}))

		const caddy = mockCaddy([
			'route-dash-risved-example-eu',
			'route-app-example-com'
		])

		setupDbForRestore(
			[{ id: 'p-1', domain: 'app.example.com', port: 4001 }],
			['p-1'],
			[]
		)

		await restoreAllRoutes(caddy)

		expect(caddy.addRoute).not.toHaveBeenCalled()
	})

	it('handles empty database gracefully', async () => {
		mockGetSetting.mockResolvedValue(null)
		const caddy = mockCaddy()

		setupDbForRestore([], [], [])

		await restoreAllRoutes(caddy)

		expect(caddy.ensureServer).toHaveBeenCalled()
		expect(caddy.addRoute).not.toHaveBeenCalled()
	})

	it('aborts if ensureServer fails', async () => {
		const caddy = mockCaddy()
		;(caddy.ensureServer as ReturnType<typeof vi.fn>).mockResolvedValue({
			success: false,
			error: 'connection refused'
		})

		await restoreAllRoutes(caddy)

		expect(caddy.addRoute).not.toHaveBeenCalled()
	})
})
