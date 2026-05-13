import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn()
	}
}))

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
}))
vi.mock('$lib/server/forgejo', () => ({
	verifyForgejoToken: vi.fn()
}))
vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`)
}))
vi.mock('$lib/server/settings', () => ({
	setSetting: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@sveltejs/kit', () => ({
	fail: vi.fn((status: number, data: unknown) => ({ status, data }))
}))

import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'
import { verifyForgejoToken } from '$lib/server/forgejo'
import { setSetting } from '$lib/server/settings'
import { fail } from '@sveltejs/kit'

const mockVerify = vi.mocked(verifyForgejoToken)
const mockSetSetting = vi.mocked(setSetting)
const mockFail = vi.mocked(fail)

/* ── connectForgejo ───────────────────────────────────────────────── */

describe('connectForgejo', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFail.mockImplementation((status: number, data: unknown) => ({ status, data }) as never)
	})

	it('fails when instanceUrl is missing', async () => {
		const fd = new FormData()
		fd.append('token', 'tok')
		const result = await connectForgejo(fd)
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'Instance URL is required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when token is missing', async () => {
		const fd = new FormData()
		fd.append('instanceUrl', 'https://codeberg.org')
		const result = await connectForgejo(fd)
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'API token is required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails on invalid URL format', async () => {
		const fd = new FormData()
		fd.append('instanceUrl', 'not-a-url')
		fd.append('token', 'tok')
		const result = await connectForgejo(fd)
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'Invalid URL format' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when verifyForgejoToken throws', async () => {
		mockVerify.mockRejectedValue(new Error('network error'))
		const fd = new FormData()
		fd.append('instanceUrl', 'https://codeberg.org')
		fd.append('token', 'tok')
		const result = await connectForgejo(fd)
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'Could not connect — check URL and token' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('inserts a new connection when none exists', async () => {
		mockVerify.mockResolvedValue({ login: 'alice', avatar_url: 'https://example.com/alice.png' } as never)
		setupSelect([])
		const insertReturning = vi.fn().mockResolvedValue([])
		const insertValues = vi.fn().mockReturnValue({ returning: insertReturning })
		mockDb.insert.mockReturnValue({ values: insertValues })

		const fd = new FormData()
		fd.append('instanceUrl', 'https://codeberg.org/')
		fd.append('token', 'my-tok')
		const result = await connectForgejo(fd)

		expect(mockDb.insert).toHaveBeenCalled()
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('updates an existing connection', async () => {
		mockVerify.mockResolvedValue({ login: 'alice', avatar_url: 'https://example.com/alice.png' } as never)
		setupSelect([{ id: 'conn-1', accountName: 'alice' }])
		const updateWhere = vi.fn().mockResolvedValue([])
		const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
		mockDb.update.mockReturnValue({ set: updateSet })

		const fd = new FormData()
		fd.append('instanceUrl', 'https://codeberg.org/')
		fd.append('token', 'my-tok')
		const result = await connectForgejo(fd)

		expect(mockDb.update).toHaveBeenCalled()
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('strips trailing slash from instanceUrl', async () => {
		mockVerify.mockResolvedValue({ login: 'bob', avatar_url: '' } as never)
		setupSelect([])
		const insertReturning = vi.fn().mockResolvedValue([])
		const insertValues = vi.fn().mockReturnValue({ returning: insertReturning })
		mockDb.insert.mockReturnValue({ values: insertValues })

		const fd = new FormData()
		fd.append('instanceUrl', 'https://forgejo.example.com///')
		fd.append('token', 'tok2')
		await connectForgejo(fd)

		const insertedValues = insertValues.mock.calls[0][0]
		expect(insertedValues.instanceUrl).toBe('https://forgejo.example.com')
	})
})

/* ── saveGithubApp ────────────────────────────────────────────────── */

describe('saveGithubApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFail.mockImplementation((status: number, data: unknown) => ({ status, data }) as never)
	})

	it('fails when any field is missing', async () => {
		const fd = new FormData()
		fd.append('appId', '123')
		const result = await saveGithubApp(fd)
		expect(fail).toHaveBeenCalledWith(400, { githubAppError: 'All fields are required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves all GitHub App settings', async () => {
		const fd = new FormData()
		fd.append('appId', '42')
		fd.append('privateKey', 'pk-secret')
		fd.append('clientId', 'Iv1.abc')
		fd.append('clientSecret', 'cs-secret')
		const result = await saveGithubApp(fd)

		expect(mockSetSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_id', '42')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_private_key', 'enc:pk-secret')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_id', 'Iv1.abc')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_secret', 'enc:cs-secret')
		expect(result).toMatchObject({ githubAppSaved: true })
	})
})

/* ── saveGitlabApp ────────────────────────────────────────────────── */

describe('saveGitlabApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFail.mockImplementation((status: number, data: unknown) => ({ status, data }) as never)
	})

	it('fails when any field is missing', async () => {
		const fd = new FormData()
		fd.append('instanceUrl', 'https://gitlab.com')
		const result = await saveGitlabApp(fd)
		expect(fail).toHaveBeenCalledWith(400, { gitlabAppError: 'All fields are required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails on invalid URL', async () => {
		const fd = new FormData()
		fd.append('instanceUrl', 'bad-url')
		fd.append('applicationId', 'app-1')
		fd.append('secret', 'sec')
		const result = await saveGitlabApp(fd)
		expect(fail).toHaveBeenCalledWith(400, { gitlabAppError: 'Invalid URL format' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves GitLab App settings and strips trailing slash', async () => {
		const fd = new FormData()
		fd.append('instanceUrl', 'https://gitlab.example.com/')
		fd.append('applicationId', 'app-99')
		fd.append('secret', 'my-sec')
		const result = await saveGitlabApp(fd)

		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.example.com')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_id', 'app-99')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_secret', 'enc:my-sec')
		expect(result).toMatchObject({ gitlabAppSaved: true })
	})
})
