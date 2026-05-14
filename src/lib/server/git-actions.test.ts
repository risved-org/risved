import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted ─────────────────────────────────────────────────────────────── */

const { mockDb, mockFail } = vi.hoisted(() => ({
	mockDb: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn()
	},
	mockFail: vi.fn((code: number, data: Record<string, unknown>) => ({ status: code, data }))
}))

/* ── Mocks ───────────────────────────────────────────────────────────────── */

vi.mock('@sveltejs/kit', () => ({ fail: mockFail }))
vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name', provider: 'provider' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))
vi.mock('$lib/server/forgejo', () => ({
	verifyForgejoToken: vi.fn()
}))
vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `encrypted:${v}`)
}))
vi.mock('$lib/server/settings', () => ({
	setSetting: vi.fn().mockResolvedValue(undefined)
}))

import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'
import { verifyForgejoToken } from '$lib/server/forgejo'
import { setSetting } from '$lib/server/settings'

const mockVerify = verifyForgejoToken as ReturnType<typeof vi.fn>
const mockSetSetting = setSetting as ReturnType<typeof vi.fn>

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function form(data: Record<string, string>): FormData {
	const fd = new FormData()
	for (const [k, v] of Object.entries(data)) fd.append(k, v)
	return fd
}

function setupSelectRows(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

function setupInsert() {
	mockDb.insert.mockReturnValue({
		values: vi.fn().mockResolvedValue([])
	})
}

function setupUpdate() {
	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue([])
		})
	})
}

/* ── connectForgejo() ────────────────────────────────────────────────────── */

describe('connectForgejo()', () => {
	beforeEach(() => vi.clearAllMocks())

	it('fails when instanceUrl is missing', async () => {
		const result = await connectForgejo(form({ token: 'tok' }))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ forgejoError: expect.stringContaining('URL') }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when token is missing', async () => {
		const result = await connectForgejo(form({ instanceUrl: 'https://git.example.com' }))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ forgejoError: expect.stringContaining('token') }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails on invalid URL format', async () => {
		const result = await connectForgejo(form({ instanceUrl: 'not-a-url', token: 'tok' }))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ forgejoError: expect.stringContaining('Invalid URL') }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails when verifyForgejoToken throws', async () => {
		mockVerify.mockRejectedValue(new Error('connection refused'))
		const result = await connectForgejo(form({ instanceUrl: 'https://git.example.com', token: 'bad-token' }))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ forgejoError: expect.stringContaining('Could not connect') }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('inserts new connection when none exists', async () => {
		mockVerify.mockResolvedValue({ login: 'alice', avatar_url: 'https://example.com/avatar.png' })
		setupSelectRows([])
		setupInsert()

		const result = await connectForgejo(form({ instanceUrl: 'https://git.example.com/', token: 'good-token' }))

		expect(mockDb.insert).toHaveBeenCalledTimes(1)
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('updates existing connection when one exists', async () => {
		mockVerify.mockResolvedValue({ login: 'alice', avatar_url: 'https://example.com/avatar.png' })
		setupSelectRows([{ id: 'conn-1' }])
		setupUpdate()

		const result = await connectForgejo(form({ instanceUrl: 'https://git.example.com/', token: 'good-token' }))

		expect(mockDb.update).toHaveBeenCalledTimes(1)
		expect(mockDb.insert).not.toHaveBeenCalled()
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('strips trailing slashes from instanceUrl', async () => {
		mockVerify.mockResolvedValue({ login: 'bob', avatar_url: '' })
		setupSelectRows([])
		const insertValues = vi.fn().mockResolvedValue([])
		mockDb.insert.mockReturnValue({ values: insertValues })

		await connectForgejo(form({ instanceUrl: 'https://git.example.com///', token: 'tok' }))

		const insertedRow = insertValues.mock.calls[0][0]
		expect(insertedRow.instanceUrl).toBe('https://git.example.com')
	})
})

/* ── saveGithubApp() ─────────────────────────────────────────────────────── */

describe('saveGithubApp()', () => {
	beforeEach(() => vi.clearAllMocks())

	it('fails when any field is missing', async () => {
		const result = await saveGithubApp(form({ appId: '123' }))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ githubAppError: expect.any(String) }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('saves all settings and returns success', async () => {
		const result = await saveGithubApp(form({
			appId: '42',
			privateKey: 'pem-content',
			clientId: 'Iv1.abc',
			clientSecret: 'secret-xyz'
		}))

		expect(mockSetSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_id', '42')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_private_key', 'encrypted:pem-content')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_id', 'Iv1.abc')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_secret', 'encrypted:secret-xyz')
		expect(result).toMatchObject({ githubAppSaved: true })
	})
})

/* ── saveGitlabApp() ─────────────────────────────────────────────────────── */

describe('saveGitlabApp()', () => {
	beforeEach(() => vi.clearAllMocks())

	it('fails when any field is missing', async () => {
		const result = await saveGitlabApp(form({ instanceUrl: 'https://gitlab.example.com' }))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ gitlabAppError: expect.any(String) }))
		expect(result).toMatchObject({ status: 400 })
	})

	it('fails on invalid instanceUrl', async () => {
		const result = await saveGitlabApp(form({
			instanceUrl: 'not-a-url',
			applicationId: 'app-id',
			secret: 'secret'
		}))
		expect(mockFail).toHaveBeenCalledWith(400, expect.objectContaining({ gitlabAppError: expect.stringContaining('Invalid URL') }))
	})

	it('saves all settings and returns success', async () => {
		const result = await saveGitlabApp(form({
			instanceUrl: 'https://gitlab.example.com/',
			applicationId: 'my-app',
			secret: 'my-secret'
		}))

		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.example.com')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_id', 'my-app')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_secret', 'encrypted:my-secret')
		expect(result).toMatchObject({ gitlabAppSaved: true })
	})
})
