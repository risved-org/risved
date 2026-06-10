import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	const returningMock = vi.fn().mockResolvedValue([])
	const valuesMock = vi.fn(() => ({ returning: returningMock }))
	const insertMock = vi.fn(() => ({ values: valuesMock }))
	return {
		db: {
			select: selectMock,
			insert: insertMock,
			__limitMock: limitMock,
			__whereMock: whereMock,
			__fromMock: fromMock,
			__returningMock: returningMock
		}
	}
})

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => 'eq') }))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: {
		id: 'id',
		provider: 'provider',
		accountName: 'account_name',
		avatarUrl: 'avatar_url'
	},
	projects: { slug: 'slug', id: 'id' },
	envVars: { projectId: 'project_id', key: 'key' }
}))

vi.mock('$lib/server/api-utils', () => ({
	slugify: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
	generateWebhookSecret: vi.fn(() => 'test-webhook-secret')
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`)
}))

vi.mock('$lib/server/pipeline/port', () => ({
	allocatePort: vi.fn().mockResolvedValue(3001)
}))

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn()
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({ exec: vi.fn() }))
}))

vi.mock('$lib/server/detection/detectors', () => ({
	detectors: [
		{ id: 'nodejs', name: 'Node.js', tier: 'free' },
		{ id: 'python', name: 'Python', tier: 'free' }
	]
}))

vi.mock('$lib/server/auto-webhook', () => ({
	registerWebhook: vi.fn()
}))

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null)
}))

import { db } from '$lib/server/db'
import { load, actions } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

const fakeProject = {
	id: 'proj-1',
	slug: 'my-app',
	repoUrl: 'https://github.com/user/my-app.git',
	branch: 'main',
	gitConnectionId: null,
	domain: null,
	frameworkId: null,
	tier: null,
	buildCommand: null,
	startCommand: null,
	releaseCommand: null,
	port: 3001
}

function makeUrl(path = '/new/import') {
	return new URL(`http://localhost${path}`)
}

/* ── load ─────────────────────────────────────────────────────────── */

describe('import load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__fromMock.mockImplementation(() => ({ where: dbAny.__whereMock }))
		dbAny.__limitMock.mockResolvedValue([])
	})

	it('returns connections list from db', async () => {
		const conn = { id: 'c1', provider: 'github', accountName: 'myuser', avatarUrl: null }
		/* load does: await db.select({...}).from(gitConnections) — from() resolves directly */
		dbAny.__fromMock.mockResolvedValueOnce([conn])

		const result = await load()

		expect(result.connections).toHaveLength(1)
		expect(result.connections[0].provider).toBe('github')
	})

	it('returns empty connections when none configured', async () => {
		dbAny.__fromMock.mockResolvedValueOnce([])
		const result = await load()
		expect(result.connections).toEqual([])
	})

	it('returns frameworks derived from detectors', async () => {
		dbAny.__fromMock.mockResolvedValueOnce([])
		const result = await load()
		expect(result.frameworks).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: 'nodejs', name: 'Node.js' })])
		)
	})
})

/* ── default action ───────────────────────────────────────────────── */

describe('import default action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		/* default chain: select().from().where().limit() */
		dbAny.__fromMock.mockImplementation(() => ({ where: dbAny.__whereMock }))
		dbAny.__whereMock.mockImplementation(() => ({ limit: dbAny.__limitMock }))
		dbAny.__limitMock.mockResolvedValue([])
		dbAny.__returningMock.mockResolvedValue([fakeProject])
	})

	it('returns fail(400) when cloneUrl is missing', async () => {
		const fd = new FormData()
		fd.set('cloneUrl', '')
		const event = {
			request: { formData: () => Promise.resolve(fd) },
			url: makeUrl()
		} as unknown as Parameters<typeof actions.default>[0]

		const result = await actions.default(event)
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns fail(409) when project slug already exists', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'existing', slug: 'my-app' }])

		const fd = new FormData()
		fd.set('cloneUrl', 'https://github.com/user/my-app.git')
		fd.set('projectName', 'my-app')
		fd.set('branch', 'main')
		const event = {
			request: { formData: () => Promise.resolve(fd) },
			url: makeUrl()
		} as unknown as Parameters<typeof actions.default>[0]

		const result = await actions.default(event)
		expect(result).toMatchObject({ status: 409 })
	})

	it('redirects to / on successful import', async () => {
		const fd = new FormData()
		fd.set('cloneUrl', 'https://github.com/user/my-app.git')
		fd.set('projectName', 'my-app')
		fd.set('branch', 'main')
		const event = {
			request: { formData: () => Promise.resolve(fd) },
			url: makeUrl()
		} as unknown as Parameters<typeof actions.default>[0]

		await expect(actions.default(event)).rejects.toMatchObject({
			status: 303,
			location: '/'
		})
	})

	it('inserts env vars when provided', async () => {
		const fd = new FormData()
		fd.set('cloneUrl', 'https://github.com/user/app.git')
		fd.set('projectName', 'app')
		fd.set('branch', 'main')
		fd.set('envKeys', 'PORT\x1FNODE_ENV')
		fd.set('envValues', '3000\x1Fproduction')
		fd.set('envSecrets', '0\x1F0')
		const event = {
			request: { formData: () => Promise.resolve(fd) },
			url: makeUrl()
		} as unknown as Parameters<typeof actions.default>[0]

		try {
			await actions.default(event)
		} catch {
			/* redirect throws */
		}

		/* one insert for project, two inserts for env vars */
		expect(db.insert).toHaveBeenCalledTimes(3)
	})

	it('derives project name from cloneUrl when projectName is blank', async () => {
		const fd = new FormData()
		fd.set('cloneUrl', 'https://github.com/user/cool-project.git')
		fd.set('projectName', '')
		fd.set('branch', 'main')
		const event = {
			request: { formData: () => Promise.resolve(fd) },
			url: makeUrl()
		} as unknown as Parameters<typeof actions.default>[0]

		try {
			await actions.default(event)
		} catch {
			/* redirect throws */
		}

		const { slugify } = await import('$lib/server/api-utils')
		expect(slugify).toHaveBeenCalledWith('cool-project')
	})

	it('calls registerWebhook when connectionId is provided', async () => {
		const fd = new FormData()
		fd.set('cloneUrl', 'https://github.com/user/app.git')
		fd.set('projectName', 'app')
		fd.set('branch', 'main')
		fd.set('connectionId', 'conn-1')
		const event = {
			request: { formData: () => Promise.resolve(fd) },
			url: makeUrl()
		} as unknown as Parameters<typeof actions.default>[0]

		try {
			await actions.default(event)
		} catch {
			/* redirect throws */
		}

		const { registerWebhook } = await import('$lib/server/auto-webhook')
		expect(registerWebhook).toHaveBeenCalled()
	})
})
