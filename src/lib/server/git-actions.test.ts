import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn()
	}
}))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: {
		id: 'id',
		provider: 'provider',
		accountName: 'account_name',
		instanceUrl: 'instance_url',
		avatarUrl: 'avatar_url',
		accessToken: 'access_token',
		updatedAt: 'updated_at'
	}
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((_col, val) => ({ op: 'eq', val }))
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

import { db } from '$lib/server/db'
import { verifyForgejoToken } from '$lib/server/forgejo'
import { setSetting } from '$lib/server/settings'
import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'

type MockDb = {
	select: ReturnType<typeof vi.fn>
	insert: ReturnType<typeof vi.fn>
	update: ReturnType<typeof vi.fn>
}
const mockDb = db as unknown as MockDb

/* ── Helpers ──────────────────────────────────────────────────────── */

function formData(fields: Record<string, string>) {
	const fd = new FormData()
	for (const [k, v] of Object.entries(fields)) fd.set(k, v)
	return fd
}

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

function setupInsertChain() {
	mockDb.insert.mockReturnValue({
		values: vi.fn().mockResolvedValue([])
	})
}

function setupUpdateChain() {
	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue([])
		})
	})
}

/* ── connectForgejo ───────────────────────────────────────────────── */

describe('connectForgejo', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when instanceUrl is missing', async () => {
		const result = await connectForgejo(formData({ token: 'tok' }))
		expect(result).toHaveProperty('status', 400)
	})

	it('returns 400 when token is missing', async () => {
		const result = await connectForgejo(formData({ instanceUrl: 'https://codeberg.org' }))
		expect(result).toHaveProperty('status', 400)
	})

	it('returns 400 for invalid URL format', async () => {
		const result = await connectForgejo(formData({ instanceUrl: 'not-a-url', token: 'tok' }))
		expect(result).toHaveProperty('status', 400)
	})

	it('returns 400 when verifyForgejoToken throws', async () => {
		vi.mocked(verifyForgejoToken).mockRejectedValue(new Error('bad token'))
		const result = await connectForgejo(
			formData({ instanceUrl: 'https://codeberg.org', token: 'tok' })
		)
		expect(result).toHaveProperty('status', 400)
	})

	it('inserts new connection when none exists', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'alice', avatar_url: 'https://img' })
		setupSelectChain([])
		setupInsertChain()

		const result = await connectForgejo(
			formData({ instanceUrl: 'https://codeberg.org', token: 'mytoken' })
		)

		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
		expect(mockDb.insert).toHaveBeenCalled()
	})

	it('updates existing connection when account already exists', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'alice', avatar_url: 'https://img' })
		setupSelectChain([{ id: 'conn-1', accountName: 'alice' }])
		setupUpdateChain()

		const result = await connectForgejo(
			formData({ instanceUrl: 'https://codeberg.org/', token: 'mytoken' })
		)

		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('strips trailing slash from instanceUrl on insert', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'bob', avatar_url: '' })
		setupSelectChain([])
		const insertValues = vi.fn().mockResolvedValue([])
		mockDb.insert.mockReturnValue({ values: insertValues })

		await connectForgejo(formData({ instanceUrl: 'https://codeberg.org/', token: 'tok' }))

		const callArg = insertValues.mock.calls[0][0]
		expect(callArg.instanceUrl).toBe('https://codeberg.org')
	})
})

/* ── saveGithubApp ────────────────────────────────────────────────── */

describe('saveGithubApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when any field is missing', async () => {
		const result = await saveGithubApp(
			formData({ appId: '123', privateKey: 'key', clientId: 'cid' })
		)
		expect(result).toHaveProperty('status', 400)
	})

	it('saves all settings and returns success', async () => {
		const result = await saveGithubApp(
			formData({ appId: '123', privateKey: 'pkey', clientId: 'cid', clientSecret: 'csecret' })
		)

		expect(result).toEqual({ githubAppSaved: true })
		expect(setSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('github_app_id', '123')
		expect(setSetting).toHaveBeenCalledWith('github_app_private_key', 'enc:pkey')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_id', 'cid')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_secret', 'enc:csecret')
	})
})

/* ── saveGitlabApp ────────────────────────────────────────────────── */

describe('saveGitlabApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when any field is missing', async () => {
		const result = await saveGitlabApp(
			formData({ instanceUrl: 'https://gitlab.com', applicationId: 'app' })
		)
		expect(result).toHaveProperty('status', 400)
	})

	it('returns 400 for invalid URL', async () => {
		const result = await saveGitlabApp(
			formData({ instanceUrl: 'not-a-url', applicationId: 'app', secret: 'sec' })
		)
		expect(result).toHaveProperty('status', 400)
	})

	it('saves all settings and returns success', async () => {
		const result = await saveGitlabApp(
			formData({
				instanceUrl: 'https://gitlab.com/',
				applicationId: 'app123',
				secret: 'mysecret'
			})
		)

		expect(result).toEqual({ gitlabAppSaved: true })
		expect(setSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.com')
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_id', 'app123')
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_secret', 'enc:mysecret')
	})
})
