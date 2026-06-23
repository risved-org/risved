import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const selectMock = vi.fn()
	const insertMock = vi.fn()
	return { db: { select: selectMock, insert: insertMock, __selectMock: selectMock, __insertMock: insertMock } }
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider' },
	projects: { id: 'id', slug: 'slug' },
	envVars: { projectId: 'project_id' }
}))

vi.mock('$lib/server/api-utils', () => ({
	slugify: vi.fn((name: string) =>
		name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
	),
	generateWebhookSecret: vi.fn(() => 'whsec_test123')
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
	createCommandRunner: vi.fn(() => ({}))
}))

vi.mock('$lib/server/detection/detectors', () => ({
	detectors: [
		{ id: 'sveltekit', name: 'SvelteKit', tier: 'standard' },
		{ id: 'nextjs', name: 'Next.js', tier: 'standard' }
	]
}))

vi.mock('$lib/server/auto-webhook', () => ({
	registerWebhook: vi.fn()
}))

vi.mock('$lib/server/settings', () => {
	const getSetting = vi.fn()
	return { getSetting, __getSetting: getSetting }
})

/* ── Imports ──────────────────────────────────────────────────────── */

import { db } from '$lib/server/db'
import { getSetting } from '$lib/server/settings'
import { load, actions } from './+page.server'

const dbAny = db as unknown as {
	__selectMock: ReturnType<typeof vi.fn>
	__insertMock: ReturnType<typeof vi.fn>
}
const mockGetSetting = getSetting as ReturnType<typeof vi.fn>

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeActionEvent(entries: Record<string, string>, urlStr = 'http://localhost/new/import') {
	const fd = new FormData()
	for (const [k, v] of Object.entries(entries)) fd.append(k, v)
	return {
		request: { formData: () => Promise.resolve(fd) },
		url: new URL(urlStr)
	} as Parameters<typeof actions.default>[0]
}

function setupProjectInsert(project: Record<string, unknown>) {
	dbAny.__insertMock.mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([project])
		})
	})
}

const defaultProject = {
	id: 'p-new',
	name: 'My Repo',
	slug: 'my-repo',
	repoUrl: 'https://github.com/org/my-repo.git',
	branch: 'main',
	gitConnectionId: null,
	domain: null,
	frameworkId: null,
	tier: null,
	port: 3001,
	buildCommand: null,
	startCommand: null,
	releaseCommand: null,
	webhookSecret: 'whsec_test123'
}

/* ── Load ──────────────────────────────────────────────────────────── */

describe('new/import load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__selectMock.mockReset()
		dbAny.__insertMock.mockReset()
	})

	it('returns git connections and framework options', async () => {
		const connections = [{ id: 'c-1', provider: 'github', accountName: 'org', avatarUrl: null }]
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue(connections)
		})

		const result = await load()
		expect(result.connections).toEqual(connections)
		expect(result.frameworks).toHaveLength(2)
		expect(result.frameworks[0].id).toBe('sveltekit')
	})

	it('returns empty connections when none exist', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue([])
		})

		const result = await load()
		expect(result.connections).toHaveLength(0)
	})
})

/* ── Default action ─────────────────────────────────────────────────── */

describe('new/import default action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__selectMock.mockReset()
		dbAny.__insertMock.mockReset()
	})

	it('returns 400 when cloneUrl is missing', async () => {
		const result = await actions.default(makeActionEvent({ projectName: 'my-app' }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 409 when slug already exists', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'existing' }])
				})
			})
		})

		const result = await actions.default(
			makeActionEvent({
				cloneUrl: 'https://github.com/org/my-repo.git',
				projectName: 'my-repo'
			})
		)
		expect(result).toMatchObject({ status: 409 })
	})

	it('creates project and redirects on success', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockGetSetting.mockResolvedValue(null)
		setupProjectInsert(defaultProject)

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/org/my-repo.git',
					repoUrl: 'https://github.com/org/my-repo',
					projectName: 'My Repo',
					branch: 'main',
					frameworkId: '',
					releaseCommand: '',
					connectionId: ''
				})
			)
		).rejects.toMatchObject({ status: 303 })
	})

	it('derives project name from clone URL when projectName is empty', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockGetSetting.mockResolvedValue(null)
		setupProjectInsert({ ...defaultProject, name: 'my-repo', slug: 'my-repo' })

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/org/my-repo.git',
					projectName: ''
				})
			)
		).rejects.toMatchObject({ status: 303 })
	})

	it('applies subdomain when baseDomain is configured', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockGetSetting
			.mockResolvedValueOnce(JSON.stringify({ baseDomain: 'example.com' }))
			.mockResolvedValue(null)
		setupProjectInsert({ ...defaultProject, domain: 'my-repo.example.com' })

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/org/my-repo.git',
					projectName: 'my-repo'
				})
			)
		).rejects.toMatchObject({ status: 303 })
	})

	it('registers webhook when connectionId is provided', async () => {
		const { registerWebhook } = await import('$lib/server/auto-webhook')

		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockGetSetting.mockResolvedValue(null)
		setupProjectInsert({ ...defaultProject, gitConnectionId: 'c-1' })

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/org/my-repo.git',
					projectName: 'My Repo',
					connectionId: 'c-1'
				})
			)
		).rejects.toMatchObject({ status: 303 })

		expect(registerWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ connectionId: 'c-1' })
		)
	})

	it('does not register webhook when connectionId is absent', async () => {
		const { registerWebhook } = await import('$lib/server/auto-webhook')

		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockGetSetting.mockResolvedValue(null)
		setupProjectInsert(defaultProject)

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/org/my-repo.git',
					projectName: 'My Repo',
					connectionId: ''
				})
			)
		).rejects.toMatchObject({ status: 303 })

		expect(registerWebhook).not.toHaveBeenCalled()
	})

	it('saves env vars when provided', async () => {
		dbAny.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockGetSetting.mockResolvedValue(null)
		setupProjectInsert(defaultProject)

		// env insert mock
		dbAny.__insertMock
			.mockReturnValueOnce({
				values: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([defaultProject])
				})
			})
			.mockReturnValue({
				values: vi.fn().mockResolvedValue(undefined)
			})

		await expect(
			actions.default(
				makeActionEvent({
					cloneUrl: 'https://github.com/org/my-repo.git',
					projectName: 'My Repo',
					envKeys: 'PORT',
					envValues: '3000',
					envSecrets: '0'
				})
			)
		).rejects.toMatchObject({ status: 303 })

		expect(dbAny.__insertMock).toHaveBeenCalledTimes(2)
	})
})
