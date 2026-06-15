import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn()
	const whereMock = vi.fn(() => ({ limit: limitMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	const returningMock = vi.fn()
	const valuesMock = vi.fn(() => ({ returning: returningMock }))
	const insertMock = vi.fn(() => ({ values: valuesMock }))
	return {
		db: {
			select: selectMock,
			insert: insertMock,
			__fromMock: fromMock,
			__whereMock: whereMock,
			__limitMock: limitMock,
			__valuesMock: valuesMock,
			__returningMock: returningMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	envVars: 'env_vars_table',
	gitConnections: 'git_connections_table'
}))

vi.mock('$lib/server/api-utils', () => ({
	slugify: vi.fn((name: string) =>
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	),
	generateWebhookSecret: vi.fn(() => 'whsec_test123')
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`)
}))

vi.mock('$lib/server/pipeline/port', () => ({
	allocatePort: vi.fn().mockResolvedValue(3002)
}))

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn()
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({}))
}))

vi.mock('$lib/server/detection/detectors', () => ({
	detectors: [
		{ id: 'sveltekit', name: 'SvelteKit', tier: 'node' },
		{ id: 'nextjs', name: 'Next.js', tier: 'node' }
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

const insertedProject = {
	id: 'proj-1',
	name: 'my-repo',
	slug: 'my-repo',
	repoUrl: 'https://github.com/user/my-repo.git',
	branch: 'main',
	port: 3002,
	frameworkId: null,
	tier: null,
	domain: null,
	gitConnectionId: null,
	webhookSecret: 'whsec_test123',
	buildCommand: null,
	startCommand: null,
	releaseCommand: null
}

function makeActionEvent(formEntries: Record<string, string>) {
	const formData = new FormData()
	for (const [key, value] of Object.entries(formEntries)) {
		formData.append(key, value)
	}
	return {
		request: { formData: () => Promise.resolve(formData) },
		url: new URL('http://localhost/new/import')
	} as Parameters<typeof actions.default>[0]
}

describe('import load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
	})

	it('returns connections list and framework options', async () => {
		const connections = [{ id: 'c-1', provider: 'github', accountName: 'user', avatarUrl: null }]
		;(db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			from: vi.fn().mockResolvedValue(connections)
		})

		const result = (await load()) as Record<string, unknown>

		expect(result.connections).toEqual(connections)
		expect(result.frameworks).toBeDefined()
		expect((result.frameworks as unknown[]).length).toBeGreaterThan(0)
	})

	it('includes sveltekit in framework options', async () => {
		;(db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			from: vi.fn().mockResolvedValue([])
		})

		const result = (await load()) as Record<string, unknown>
		const frameworks = result.frameworks as Array<{ id: string; name: string }>
		const sk = frameworks.find((f) => f.id === 'sveltekit')
		expect(sk?.name).toBe('SvelteKit')
	})
})

describe('import action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
		dbAny.__returningMock.mockResolvedValue([insertedProject])
	})

	it('fails when cloneUrl is missing', async () => {
		const result = await actions.default(makeActionEvent({ repoUrl: 'https://example.com/r.git' }))
		expect(result).toMatchObject({ status: 400 })
		expect(result?.data?.error).toContain('No repository selected')
	})

	it('fails when project name cannot be derived from URL', async () => {
		/* A bare slash strips to empty, so name derivation fails */
		const result = await actions.default(makeActionEvent({ cloneUrl: '/' }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when slug already exists', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'existing' }])
		const result = await actions.default(
			makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' })
		)
		expect(result).toMatchObject({ status: 409 })
		expect(result?.data?.error).toContain('already exists')
	})

	it('redirects to / on successful import', async () => {
		await expect(
			actions.default(makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' }))
		).rejects.toMatchObject({ status: 303, location: '/' })
	})

	it('uses explicit projectName over URL-derived name', async () => {
		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/user/my-repo.git',
					projectName: 'Custom Name'
				})
			)
		).rejects.toMatchObject({ status: 303 })
		const insertValues = dbAny.__valuesMock.mock.calls[0]?.[0]
		expect(insertValues?.name).toBe('Custom Name')
	})

	it('defaults branch to main when not provided', async () => {
		await expect(
			actions.default(makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' }))
		).rejects.toMatchObject({ status: 303 })
		const insertValues = dbAny.__valuesMock.mock.calls[0]?.[0]
		expect(insertValues?.branch).toBe('main')
	})

	it('uses provided branch', async () => {
		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/user/my-repo.git',
					branch: 'develop'
				})
			)
		).rejects.toMatchObject({ status: 303 })
		const insertValues = dbAny.__valuesMock.mock.calls[0]?.[0]
		expect(insertValues?.branch).toBe('develop')
	})

	it('inserts env vars when provided', async () => {
		const formData = new FormData()
		formData.set('cloneUrl', 'https://github.com/user/my-repo.git')
		formData.set('envKeys', 'API_KEY\x1FDEBUG')
		formData.set('envValues', 'secret-value\x1Ftrue')
		formData.set('envSecrets', '1\x1F0')

		await expect(
			actions.default({
				request: { formData: () => Promise.resolve(formData) },
				url: new URL('http://localhost/new/import')
			} as Parameters<typeof actions.default>[0])
		).rejects.toMatchObject({ status: 303 })

		/* projects insert + 2 envVar inserts = 3 total values() calls */
		expect(dbAny.__valuesMock).toHaveBeenCalledTimes(3)
	})

	it('skips env vars with invalid key names', async () => {
		const formData = new FormData()
		formData.set('cloneUrl', 'https://github.com/user/my-repo.git')
		formData.set('envKeys', '123INVALID\x1FVALID_KEY')
		formData.set('envValues', 'v1\x1Fv2')
		formData.set('envSecrets', '0\x1F0')

		await expect(
			actions.default({
				request: { formData: () => Promise.resolve(formData) },
				url: new URL('http://localhost/new/import')
			} as Parameters<typeof actions.default>[0])
		).rejects.toMatchObject({ status: 303 })

		/* Only VALID_KEY passes validation: projects insert + 1 envVar insert = 2 calls */
		expect(dbAny.__valuesMock).toHaveBeenCalledTimes(2)
	})

	it('applies domain_config subdomain when setting is present', async () => {
		const { getSetting } = await import('$lib/server/settings')
		;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			JSON.stringify({ baseDomain: 'example.com' })
		)

		await expect(
			actions.default(makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' }))
		).rejects.toMatchObject({ status: 303 })

		const insertValues = dbAny.__valuesMock.mock.calls[0]?.[0]
		expect(insertValues?.domain).toBe('my-repo.example.com')
	})

	it('registers webhook when connectionId is provided', async () => {
		const { registerWebhook } = await import('$lib/server/auto-webhook')

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/user/my-repo.git',
					connectionId: 'conn-1'
				})
			)
		).rejects.toMatchObject({ status: 303 })

		expect(registerWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ connectionId: 'conn-1' })
		)
	})
})

describe('import URL utilities (pure)', () => {
	it('derives project name from clone URL', () => {
		const deriveNameFromUrl = (url: string): string => {
			const cleaned = url.replace(/\/$/, '').replace(/\.git$/, '')
			const parts = cleaned.split('/')
			return parts[parts.length - 1] || ''
		}
		expect(deriveNameFromUrl('https://github.com/user/my-app.git')).toBe('my-app')
		expect(deriveNameFromUrl('https://gitlab.com/org/project')).toBe('project')
		expect(deriveNameFromUrl('https://codeberg.org/user/repo.git/')).toBe('repo')
	})
})
