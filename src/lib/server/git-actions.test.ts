import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockFail, mockVerifyForgejoToken, mockEncrypt, mockSetSetting } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
	mockFail: vi.fn((status: number, data: unknown) => ({ status, data })),
	mockVerifyForgejoToken: vi.fn(),
	mockEncrypt: vi.fn((v: string) => `enc:${v}`),
	mockSetSetting: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@sveltejs/kit', () => ({ fail: mockFail }))
vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((_a: unknown, _b: unknown) => 'eq_result')
}))
vi.mock('$lib/server/forgejo', () => ({ verifyForgejoToken: mockVerifyForgejoToken }))
vi.mock('$lib/server/crypto', () => ({ encrypt: mockEncrypt }))
vi.mock('$lib/server/settings', () => ({ setSetting: mockSetSetting }))

import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'

function makeSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

function makeInsert() {
	mockDb.insert.mockReturnValue({
		values: vi.fn().mockResolvedValue(undefined)
	})
}

function makeUpdate() {
	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	})
}

function fd(pairs: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(pairs)) form.set(k, v)
	return form
}

describe('connectForgejo', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		makeSelect([])
		makeInsert()
		makeUpdate()
	})

	it('fails when instanceUrl is missing', async () => {
		const result = await connectForgejo(fd({ token: 'tok' }))
		expect(mockFail).toHaveBeenCalledWith(400, { forgejoError: 'Instance URL is required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when token is missing', async () => {
		const result = await connectForgejo(fd({ instanceUrl: 'https://codeberg.org' }))
		expect(mockFail).toHaveBeenCalledWith(400, { forgejoError: 'API token is required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails on invalid URL', async () => {
		const result = await connectForgejo(fd({ instanceUrl: 'not-a-url', token: 'tok' }))
		expect(mockFail).toHaveBeenCalledWith(400, { forgejoError: 'Invalid URL format' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when verifyForgejoToken throws', async () => {
		mockVerifyForgejoToken.mockRejectedValue(new Error('bad token'))
		const result = await connectForgejo(fd({ instanceUrl: 'https://codeberg.org', token: 'bad' }))
		expect(mockFail).toHaveBeenCalledWith(400, { forgejoError: 'Could not connect — check URL and token' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('inserts new connection and returns success', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://img.example' })
		makeSelect([])

		const result = await connectForgejo(fd({ instanceUrl: 'https://codeberg.org/', token: 'tok' }))
		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
		expect(mockDb.insert).toHaveBeenCalled()
	})

	it('updates existing connection and returns success', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://img.example' })
		makeSelect([{ id: 'conn-1', accountName: 'alice' }])

		const result = await connectForgejo(fd({ instanceUrl: 'https://codeberg.org/', token: 'tok' }))
		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('strips trailing slash from instanceUrl', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'bob', avatar_url: '' })
		const insertValuesMock = vi.fn().mockResolvedValue(undefined)
		mockDb.insert.mockReturnValue({ values: insertValuesMock })

		await connectForgejo(fd({ instanceUrl: 'https://codeberg.org///', token: 'tok' }))
		const insertedValues = insertValuesMock.mock.calls[0][0]
		expect(insertedValues.instanceUrl).toBe('https://codeberg.org')
	})
})

describe('saveGithubApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSetSetting.mockResolvedValue(undefined)
	})

	it('fails when any field is missing', async () => {
		const result = await saveGithubApp(fd({ appId: '123', privateKey: 'pk' }))
		expect(mockFail).toHaveBeenCalledWith(400, { githubAppError: 'All fields are required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves all settings and returns success', async () => {
		const result = await saveGithubApp(
			fd({ appId: '123', privateKey: 'pk', clientId: 'cid', clientSecret: 'csec' })
		)
		expect(result).toEqual({ githubAppSaved: true })
		expect(mockSetSetting).toHaveBeenCalledTimes(5)
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_id', '123')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_id', 'cid')
	})

	it('encrypts private key and client secret', async () => {
		await saveGithubApp(
			fd({ appId: '1', privateKey: 'mypk', clientId: 'cid', clientSecret: 'mysec' })
		)
		expect(mockEncrypt).toHaveBeenCalledWith('mypk')
		expect(mockEncrypt).toHaveBeenCalledWith('mysec')
	})
})

describe('saveGitlabApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSetSetting.mockResolvedValue(undefined)
	})

	it('fails when any field is missing', async () => {
		const result = await saveGitlabApp(fd({ instanceUrl: 'https://gitlab.com' }))
		expect(mockFail).toHaveBeenCalledWith(400, { gitlabAppError: 'All fields are required' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails on invalid instanceUrl', async () => {
		const result = await saveGitlabApp(
			fd({ instanceUrl: 'bad-url', applicationId: 'aid', secret: 'sec' })
		)
		expect(mockFail).toHaveBeenCalledWith(400, { gitlabAppError: 'Invalid URL format' })
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves all settings and returns success', async () => {
		const result = await saveGitlabApp(
			fd({ instanceUrl: 'https://gitlab.example.com/', applicationId: 'aid', secret: 'sec' })
		)
		expect(result).toEqual({ gitlabAppSaved: true })
		expect(mockSetSetting).toHaveBeenCalledTimes(4)
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.example.com')
	})

	it('encrypts client secret', async () => {
		await saveGitlabApp(
			fd({ instanceUrl: 'https://gitlab.example.com', applicationId: 'aid', secret: 'mysec' })
		)
		expect(mockEncrypt).toHaveBeenCalledWith('mysec')
	})
})
