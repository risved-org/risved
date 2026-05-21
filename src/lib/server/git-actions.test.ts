import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockVerifyForgejoToken, mockEncrypt, mockSetSetting } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
	mockVerifyForgejoToken: vi.fn(),
	mockEncrypt: vi.fn((v: string) => `enc:${v}`),
	mockSetSetting: vi.fn()
}))

vi.mock('@sveltejs/kit', () => ({
	fail: vi.fn((status: number, data: unknown) => ({ status, data }))
}))
vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))
vi.mock('$lib/server/forgejo', () => ({ verifyForgejoToken: mockVerifyForgejoToken }))
vi.mock('$lib/server/crypto', () => ({ encrypt: mockEncrypt }))
vi.mock('$lib/server/settings', () => ({ setSetting: mockSetSetting }))

import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'
import { fail } from '@sveltejs/kit'

function makeForm(data: Record<string, string>): FormData {
	const fd = new FormData()
	for (const [k, v] of Object.entries(data)) fd.append(k, v)
	return fd
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	mockSetSetting.mockResolvedValue(undefined)
})

describe('connectForgejo', () => {
	it('fails when instanceUrl is missing', async () => {
		const result = await connectForgejo(makeForm({ token: 'tok' }))
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'Instance URL is required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when token is missing', async () => {
		const result = await connectForgejo(makeForm({ instanceUrl: 'https://forgejo.example.com' }))
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'API token is required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when instanceUrl is not a valid URL', async () => {
		const result = await connectForgejo(makeForm({ instanceUrl: 'not-a-url', token: 'tok' }))
		expect(fail).toHaveBeenCalledWith(400, { forgejoError: 'Invalid URL format' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when verifyForgejoToken throws', async () => {
		mockVerifyForgejoToken.mockRejectedValue(new Error('network error'))
		const result = await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com', token: 'tok' })
		)
		expect(fail).toHaveBeenCalledWith(400, {
			forgejoError: 'Could not connect — check URL and token'
		})
		expect(result).toMatchObject({ status: 400 })
	})

	it('inserts a new connection when none exists', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://x.com/av' })
		setupSelect([])
		const insertValues = vi.fn().mockResolvedValue(undefined)
		mockDb.insert.mockReturnValue({ values: insertValues })

		const result = await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com/', token: 'secret' })
		)

		expect(mockDb.insert).toHaveBeenCalled()
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'forgejo',
				accountName: 'alice',
				instanceUrl: 'https://forgejo.example.com',
				accessToken: 'enc:secret',
				avatarUrl: 'https://x.com/av'
			})
		)
		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
	})

	it('updates an existing connection', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://x.com/av' })
		setupSelect([{ id: 'existing-id' }])
		const mockWhere = vi.fn().mockResolvedValue(undefined)
		const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
		mockDb.update.mockReturnValue({ set: mockSet })

		const result = await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com', token: 'newsecret' })
		)

		expect(mockDb.update).toHaveBeenCalled()
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({
				accessToken: 'enc:newsecret',
				instanceUrl: 'https://forgejo.example.com',
				avatarUrl: 'https://x.com/av'
			})
		)
		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
	})

	it('strips trailing slash from instanceUrl', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'bob', avatar_url: '' })
		setupSelect([])
		const insertValues = vi.fn().mockResolvedValue(undefined)
		mockDb.insert.mockReturnValue({ values: insertValues })

		await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com///', token: 'tok' })
		)

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ instanceUrl: 'https://forgejo.example.com' })
		)
	})
})

describe('saveGithubApp', () => {
	it('fails when any required field is missing', async () => {
		const result = await saveGithubApp(
			makeForm({ appId: '1', privateKey: 'key', clientId: 'cid' })
		)
		expect(fail).toHaveBeenCalledWith(400, { githubAppError: 'All fields are required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves all github app settings and returns success', async () => {
		const result = await saveGithubApp(
			makeForm({ appId: '42', privateKey: 'pkey', clientId: 'cid', clientSecret: 'csec' })
		)

		expect(mockSetSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_id', '42')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_private_key', 'enc:pkey')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_id', 'cid')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_secret', 'enc:csec')
		expect(result).toEqual({ githubAppSaved: true })
	})
})

describe('saveGitlabApp', () => {
	it('fails when any required field is missing', async () => {
		const result = await saveGitlabApp(
			makeForm({ instanceUrl: 'https://gitlab.example.com', applicationId: 'aid' })
		)
		expect(fail).toHaveBeenCalledWith(400, { gitlabAppError: 'All fields are required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when instanceUrl is not a valid URL', async () => {
		const result = await saveGitlabApp(
			makeForm({ instanceUrl: 'not-a-url', applicationId: 'aid', secret: 'sec' })
		)
		expect(fail).toHaveBeenCalledWith(400, { gitlabAppError: 'Invalid URL format' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves all gitlab app settings and returns success', async () => {
		const result = await saveGitlabApp(
			makeForm({ instanceUrl: 'https://gitlab.example.com/', applicationId: 'aid', secret: 'sec' })
		)

		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith(
			'gitlab_instance_url',
			'https://gitlab.example.com'
		)
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_id', 'aid')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_secret', 'enc:sec')
		expect(result).toEqual({ gitlabAppSaved: true })
	})

	it('strips trailing slash from instanceUrl', async () => {
		await saveGitlabApp(
			makeForm({ instanceUrl: 'https://gitlab.example.com///', applicationId: 'aid', secret: 'sec' })
		)
		expect(mockSetSetting).toHaveBeenCalledWith(
			'gitlab_instance_url',
			'https://gitlab.example.com'
		)
	})
})
