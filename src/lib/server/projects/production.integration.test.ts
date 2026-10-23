import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import * as schema from '../db/schema'

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue({ success: true })
}))
vi.mock('$lib/server/pipeline/rollback', () => ({
	runRollback: vi.fn().mockResolvedValue({ success: true, deploymentId: 'rollback' })
}))
vi.mock('$lib/server/pipeline/domains', () => ({ getManagedAppDomain: async () => null }))

let client: ReturnType<typeof createClient>
let database: ReturnType<typeof drizzle<typeof schema>>
let read: typeof import('./read')
let deploy: typeof import('./deploy')
let logs: typeof import('./logs')
let rollback: typeof import('./rollback')

beforeEach(async () => {
	vi.resetModules()
	client = createClient({ url: ':memory:' })
	database = drizzle(client, { schema })
	const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
		entries: Array<{ tag: string }>
	}
	for (const entry of journal.entries)
		await client.executeMultiple(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'))
	vi.doMock('$lib/server/db', () => ({ db: database }))
	read = await import('./read')
	deploy = await import('./deploy')
	logs = await import('./logs')
	rollback = await import('./rollback')
	await database
		.insert(schema.projects)
		.values({ id: 'p', name: 'App', slug: 'app', repoUrl: 'https://github.com/o/r', port: 3001 })
})
afterEach(() => client.close())

/** Seed a deployment whose timestamp is explicitly controlled. */
async function deployment(id: string, status: string, date: string, triggerType = 'manual') {
	await database
		.insert(schema.deployments)
		.values({
			id,
			projectId: 'p',
			status,
			triggerType,
			imageTag: 'image:' + id,
			createdAt: date,
			startedAt: date
		})
}

it('keeps preview images out of production history and finds a live release older than five failures', async () => {
	await deployment('production', 'live', '2026-01-01')
	for (let index = 1; index <= 5; index++)
		await deployment('failed-' + index, 'failed', `2026-02-0${index}`)
	await deployment('preview', 'live', '2026-03-01', 'preview')
	await deployment('legacy-preview', 'live', '2026-04-01')
 await deployment('older-preview', 'live', '2026-05-01')
 await database.update(schema.deployments).set({ containerName: 'app-pr-2' }).where(eq(schema.deployments.id, 'older-preview'))
	await database
		.insert(schema.previewDeployments)
		.values({ projectId: 'p', prNumber: 1, branch: 'preview', deploymentId: 'legacy-preview' })
	const detail = await read.getProjectDetail('p')
	expect(detail.currentDeployment?.id).toBe('production')
	expect(detail.recentDeployments).toHaveLength(5)
	expect(detail.recentDeployments.every((row) => row.id.startsWith('failed-'))).toBe(true)
	expect((await read.listProjects())[0].lastDeployment?.id).toBe('failed-5')
	await expect(logs.getDeploymentDetail('preview')).rejects.toMatchObject({ code: 'not_found' })
	await expect(rollback.rollbackProject('p', 'legacy-preview')).rejects.toMatchObject({
		code: 'not_found'
	})
})

it('ignores running previews and recovers production rows left by a previous process', async () => {
	await deployment('preview', 'running', '2020-01-01', 'preview')
	expect(await deploy.findRunningDeployment('p')).toBeNull()
	await deployment('interrupted', 'running', '2020-01-01')
	await deploy.deployProject('p')
	const rows = await database.select().from(schema.deployments)
	expect(rows.find((row) => row.id === 'interrupted')?.status).toBe('failed')
	expect(rows.find((row) => row.id === 'preview')?.status).toBe('running')
	expect(
		rows.filter((row) => row.status === 'running' && row.triggerType !== 'preview')
	).toHaveLength(1)
})
