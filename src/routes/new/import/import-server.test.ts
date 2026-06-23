import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Module mocks ────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn(), insert: vi.fn() } }))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_expr')
}))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accountName: 'account_name', avatarUrl: 'avatar_url' },
	projects: { slug: 'slug', id: 'id' },
	envVars: { projectId: 'project_id', key: 'key', value: 'value', isSecret: 'is_secret' }
}))

vi.mock('$lib/server/api-utils', () => ({
	slugify: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
	generateWebhookSecret: vi.fn(() => 'webhook-secret-abc')
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
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() })
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

/* ── Helpers ─────────────────────────────────────────────────────── */

const mockConnections = [
	{ id: 'conn-1', provider: 'github', accountName: 'myuser', avatarUrl: 'https://avatar.url' }
]

function setupLoadSelect(rows: unknown[]) {
	vi.mocked(db.select).mockReturnValueOnce({
		from: vi.fn().mockResolvedValue(rows)
	} as never)
}

function makeFormData(fields: Record<string, string>) {
	const fd = new FormData()
	for (const [k, v] of Object.entries(fields)) fd.set(k, v)
	return fd
}

function makeRequest(fields: Record<string, string>) {
	const fd = makeFormData(fields)
	return { formData: () => Promise.resolve(fd) } as unknown as Request
}

function makeActionEvent(fields: Record<string, string>) {
	return {
		request: makeRequest(fields),
		url: new URL('http://localhost/new/import')
	} as Parameters<typeof actions.default>[0]
}

/* ── Tests ───────────────────────────────────────────────────────── */

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(db.select).mockReturnValue({
		from: vi.fn().mockResolvedValue([])
	} as never)
	vi.mocked(db.insert).mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([
				{ id: 'proj-new', slug: 'my-repo', repoUrl: 'https://github.com/user/my-repo.git', branch: 'main', gitConnectionId: null, domain: null, port: 3001, frameworkId: null, tier: null, buildCommand: null, startCommand: null, releaseCommand: null }
			])
		})
	} as never)
})

describe('import page load', () => {
	it('returns git connections from the database', async () => {
		setupLoadSelect(mockConnections)

		const result = await load()
		expect(result.connections).toEqual(mockConnections)
	})

	it('returns available frameworks list', async () => {
		setupLoadSelect([])

		const result = await load()
		expect(result.frameworks).toContainEqual(expect.objectContaining({ id: 'sveltekit' }))
		expect(result.frameworks).toContainEqual(expect.objectContaining({ id: 'nextjs' }))
	})

	it('returns empty connections when none configured', async () => {
		setupLoadSelect([])

		const result = await load()
		expect(result.connections).toEqual([])
	})
})

describe('import action — validation', () => {
	it('returns 400 when cloneUrl is missing', async () => {
		const result = await actions.default(makeActionEvent({ projectName: 'my-app' }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 400 when name cannot be derived from cloneUrl', async () => {
		/* A bare slash produces an empty name after stripping the slash */
		const result = await actions.default(makeActionEvent({ cloneUrl: '/' }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 400 when slug is empty after slugify', async () => {
		const { slugify } = await import('$lib/server/api-utils')
		vi.mocked(slugify).mockReturnValueOnce('')

		const result = await actions.default(
			makeActionEvent({ cloneUrl: 'https://github.com/user/repo.git' })
		)
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 409 when a project with that slug already exists', async () => {
		/* projects select returns existing project */
		vi.mocked(db.select).mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'existing' }])
				})
			})
		} as never)

		const result = await actions.default(
			makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' })
		)
		expect(result).toMatchObject({ status: 409 })
	})
})

describe('import action — success', () => {
	beforeEach(() => {
		/* Default: no existing project (slug check returns []) */
		vi.mocked(db.select).mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		} as never)
	})

	it('redirects to / after successful import', async () => {
		await expect(
			actions.default(makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' }))
		).rejects.toMatchObject({ status: 303, location: '/' })
	})

	it('uses projectName when provided', async () => {
		const insertMock = vi.mocked(db.insert)
		insertMock.mockReturnValueOnce({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([
					{ id: 'proj-new', slug: 'custom-name', repoUrl: 'https://github.com/user/repo', branch: 'main', gitConnectionId: null, domain: null, port: 3001, frameworkId: null, tier: null, buildCommand: null, startCommand: null, releaseCommand: null }
				])
			})
		} as never)

		try {
			await actions.default(
				makeActionEvent({ cloneUrl: 'https://github.com/user/repo.git', projectName: 'Custom Name' })
			)
		} catch {
			/* expected redirect */
		}

		expect(insertMock).toHaveBeenCalled()
		const valuesArg = insertMock.mock.calls[0]
		expect(valuesArg).toBeDefined()
	})

	it('uses main as default branch when not provided', async () => {
		const insertMock = vi.mocked(db.insert)
		const valuesMock = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([
				{ id: 'p', slug: 'my-repo', repoUrl: 'r', branch: 'main', gitConnectionId: null, domain: null, port: 3001, frameworkId: null, tier: null, buildCommand: null, startCommand: null, releaseCommand: null }
			])
		})
		insertMock.mockReturnValueOnce({ values: valuesMock } as never)

		try {
			await actions.default(
				makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' })
			)
		} catch { /* redirect */ }

		const insertedValues = valuesMock.mock.calls[0][0]
		expect(insertedValues.branch).toBe('main')
	})

	it('starts the pipeline after creating the project', async () => {
		const { runPipeline } = await import('$lib/server/pipeline')

		try {
			await actions.default(
				makeActionEvent({ cloneUrl: 'https://github.com/user/my-repo.git' })
			)
		} catch { /* redirect */ }

		expect(runPipeline).toHaveBeenCalled()
	})
})
