import { describe, expect, it } from 'vitest'

describe('crons page source', () => {
	it('renders the scheduled tasks page with add and list controls', async () => {
		const mod = await import('./+page.svelte?raw')

		expect(mod.default).toContain('Scheduled Tasks')
		expect(mod.default).toContain('add-cron-btn')
		expect(mod.default).toContain('cron-list')
		expect(mod.default).toContain('add-cron-form')
	})

	it('uses the existing cron project API for mutations', async () => {
		const mod = await import('./+page.svelte?raw')

		expect(mod.default).toContain('/api/projects/${data.project.id}/crons')
		expect(mod.default).toContain("method: 'POST'")
		expect(mod.default).toContain("method: 'PUT'")
		expect(mod.default).toContain("method: 'DELETE'")
	})
})
