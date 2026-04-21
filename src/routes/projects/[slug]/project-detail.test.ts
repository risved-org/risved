import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const orderByMock = vi.fn().mockResolvedValue([])
	const limitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock, orderBy: orderByMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	const deleteWhereMock = vi.fn().mockResolvedValue(undefined)
	const deleteMock = vi.fn(() => ({ where: deleteWhereMock }))
	return {
		db: {
			select: selectMock,
			delete: deleteMock,
			__limitMock: limitMock,
			__orderByMock: orderByMock,
			__whereMock: whereMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	desc: vi.fn(() => 'desc_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	domains: 'domains_table',
	envVars: 'env_vars_table',
	webhookDeliveries: 'webhook_deliveries_table',
	healthEvents: 'health_events_table',
	cronJobs: 'cron_jobs_table',
	cronRuns: 'cron_runs_table'
}))

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue({
		deleteProjectJobs: vi.fn().mockResolvedValue(undefined)
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'
import { actions } from './settings/+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('project overview load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
		dbAny.__orderByMock.mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('calls db.select for project lookup', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		try {
			await load({ params: { slug: 'test-app' } } as Parameters<typeof load>[0])
		} catch {
			/* expected 404 */
		}

		expect(db.select).toHaveBeenCalled()
	})
})

describe('settings delete action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
	})

	it('returns 404 when project not found for delete', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		const result = await actions.delete({
			params: { slug: 'nonexistent' }
		} as Parameters<typeof actions.delete>[0])
		expect(result).toMatchObject({ status: 404 })
	})

	it('deletes project and redirects', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }])

		await expect(
			actions.delete({
				params: { slug: 'test-app' }
			} as Parameters<typeof actions.delete>[0])
		).rejects.toMatchObject({ status: 303, location: '/' })
	})
})

describe('project layout source', () => {
	it('has project header with name and framework', async () => {
		const mod = await import('./+layout.svelte?raw')
		expect(mod.default).toContain('project-header')
		expect(mod.default).toContain('framework-badge')
	})

	it('has tab bar with all tabs', async () => {
		const mod = await import('./+layout.svelte?raw')
		expect(mod.default).toContain('project-tabs')
		expect(mod.default).toContain('Overview')
		expect(mod.default).toContain('Deployments')
		expect(mod.default).toContain('Logs')
		expect(mod.default).toContain('Metrics')
		expect(mod.default).toContain('Settings')
	})
})

describe('overview page source', () => {
	it('has deployments section', async () => {
		const mod = await import('./+page.svelte?raw')
		expect(mod.default).toContain('deployments-section')
		expect(mod.default).toContain('deploy-row')
	})

	it('has health section', async () => {
		const mod = await import('./+page.svelte?raw')
		expect(mod.default).toContain('health-section')
	})

	it('has resource charts', async () => {
		const mod = await import('./+page.svelte?raw')
		expect(mod.default).toContain('resource-section')
	})

	it('has rollback button', async () => {
		const mod = await import('./+page.svelte?raw')
		expect(mod.default).toContain('btn-rollback')
		expect(mod.default).toContain('handleRollback')
	})

	it('has View all link to deployments tab', async () => {
		const mod = await import('./+page.svelte?raw')
		expect(mod.default).toContain('View all →')
	})

	it('exposes triggerType and imageTag in deployment data', async () => {
		const mod = await import('./+page.server.ts?raw')
		expect(mod.default).toContain('triggerType')
		expect(mod.default).toContain('imageTag')
	})
})

describe('settings page source', () => {
	it('has all config sections', async () => {
		const mod = await import('./settings/+page.svelte?raw')
		expect(mod.default).toContain('scripts-section')
		expect(mod.default).toContain('env-section')
		expect(mod.default).toContain('domains-section')
		expect(mod.default).toContain('crons-section')
		expect(mod.default).toContain('integrations-section')
		expect(mod.default).toContain('danger-zone')
	})

	it('uses Edit as the universal verb for sub-page links', async () => {
		const mod = await import('./settings/+page.svelte?raw')
		expect(mod.default).toContain('edit-domains-btn')
		expect(mod.default).toContain('edit-webhook-btn')
		expect(mod.default).toContain('edit-checks-btn')
		expect(mod.default).toContain('edit-crons-btn')
	})

	it('has danger zone with delete', async () => {
		const mod = await import('./settings/+page.svelte?raw')
		expect(mod.default).toContain('Delete project')
		expect(mod.default).toContain('confirm-delete-btn')
	})

	it('uses enhance for form submission', async () => {
		const mod = await import('./settings/+page.svelte?raw')
		expect(mod.default).toContain('use:enhance')
	})
})

describe('deployments page source', () => {
	it('has status filter', async () => {
		const mod = await import('./deployments/+page.svelte?raw')
		expect(mod.default).toContain('status-filter')
		expect(mod.default).toContain('Succeeded')
		expect(mod.default).toContain('Failed')
	})

	it('has commit grouping', async () => {
		const mod = await import('./deployments/+page.svelte?raw')
		expect(mod.default).toContain('deploy-group')
		expect(mod.default).toContain('groupByCommit')
	})
})
