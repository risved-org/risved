import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { readFileSync, readdirSync } from 'node:fs'
import * as schema from './db/schema'

const mocks = vi.hoisted(() => ({
	database: {} as { db: ReturnType<typeof drizzle> },
	addRoute: vi.fn().mockResolvedValue({ success: true }),
	removeRoute: vi.fn().mockResolvedValue({ success: true })
}))
vi.mock('$lib/server/db', () => ({
	get db() {
		return mocks.database.db
	}
}))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn(),
	jsonError: (status: number, error: string) => Response.json({ error }, { status })
}))
vi.mock('$lib/server/caddy', () => ({
	createCaddyClient: () => ({
		addRoute: mocks.addRoute,
		removeRoute: mocks.removeRoute,
		addRedirectRoute: vi.fn(),
		removeRedirectRoute: vi.fn()
	})
}))

import { POST, GET } from '../../routes/api/projects/[id]/domains/+server'
import { DELETE } from '../../routes/api/projects/[id]/domains/[did]/+server'
import { hasRootConflict, hasExplicitRootConflict } from './domain-conflicts'

const client = createClient({ url: ':memory:' })

beforeAll(async () => {
	mocks.database.db = drizzle(client)
	for (const file of readdirSync('drizzle')
		.filter(f => f.endsWith('.sql'))
		.sort()) {
		await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'))
	}
})
afterAll(() => client.close())
beforeEach(async () => {
	vi.clearAllMocks()
	await mocks.database.db.delete(schema.domains)
	await mocks.database.db.delete(schema.projects)
	for (const id of ['main', 'blog']) {
		await mocks.database.db.insert(schema.projects).values({
			id,
			name: id,
			slug: id,
			repoUrl: 'https://example.test/repo',
			port: id === 'main' ? 3001 : 3002
		})
	}
})

/** Create a route event against the isolated in-memory database. */
function event(id: string, body: unknown = {}, did?: string) {
	return {
		params: { id, did },
		request: new Request('http://localhost/domains', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never
}

it('creates shared host mappings, returns their settings and rejects duplicates across apps', async () => {
	expect((await POST(event('main', { hostname: 'onui.com' }))).status).toBe(201)
	const blog = await POST(
		event('blog', { hostname: 'ONUI.com', pathPrefix: '/blog', forwardingMode: 'strip' })
	)
	expect(blog.status).toBe(201)
	expect(await blog.json()).toMatchObject({
		hostname: 'onui.com',
		pathPrefix: '/blog',
		forwardingMode: 'strip'
	})
	expect(mocks.addRoute).toHaveBeenLastCalledWith({
		hostname: 'onui.com',
		port: 3002,
		pathPrefix: '/blog',
		forwardingMode: 'strip'
	})
	expect((await POST(event('main', { hostname: 'onui.com', pathPrefix: '/blog' }))).status).toBe(
		409
	)
	expect((await GET(event('main'))).status).toBe(200)
	expect(await (await GET(event('main'))).json()).toMatchObject([
		{ pathPrefix: '/', forwardingMode: 'preserve' }
	])
})

it('removes only the selected app mount and leaves its sibling intact', async () => {
	await POST(event('main', { hostname: 'onui.com' }))
	const blog = await (
		await POST(event('blog', { hostname: 'onui.com', pathPrefix: '/blog' }))
	).json()
	expect((await DELETE(event('main', {}, blog.id))).status).toBe(404)
	expect((await DELETE(event('blog', {}, blog.id))).status).toBe(200)
	expect(mocks.removeRoute).toHaveBeenCalledWith('onui.com', '/blog')
	expect(await mocks.database.db.select().from(schema.domains)).toMatchObject([
		{ projectId: 'main', pathPrefix: '/' }
	])
})

it('rejects invalid prefixes and modes without touching the database or proxy', async () => {
	for (const body of [
		{ pathPrefix: '/blog/' },
		{ pathPrefix: '/blog*' },
		{ forwardingMode: 'rewrite' }
	]) {
		expect((await POST(event('blog', { hostname: 'onui.com', ...body }))).status).toBe(400)
	}
	expect(mocks.addRoute).not.toHaveBeenCalled()
	expect(await mocks.database.db.select().from(schema.domains)).toHaveLength(0)
})

it('reserves legacy project roots while permitting another app on a subpath', async () => {
	await client.execute("UPDATE projects SET domain = 'onui.com' WHERE id = 'main'")
	expect(await hasRootConflict('onui.com', 'blog')).toBe(true)
	expect(await hasRootConflict('onui.com', 'main')).toBe(false)
	expect((await POST(event('blog', { hostname: 'onui.com' }))).status).toBe(409)
	expect((await POST(event('blog', { hostname: 'onui.com', pathPrefix: '/blog' }))).status).toBe(
		201
	)
	await POST(event('main', { hostname: 'another.test' }))
	expect(await hasExplicitRootConflict('another.test', 'blog')).toBe(true)
})
