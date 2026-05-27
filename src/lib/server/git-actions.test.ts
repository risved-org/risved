import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const selectMock = vi.fn()
	const insertMock = vi.fn()
	const updateMock = vi.fn()
	return {
		db: {
			select: selectMock,
			insert: insertMock,
			update: updateMock,
			__selectMock: selectMock,
			__insertMock: insertMock,
			__updateMock: updateMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: {
		accountName: 'account_name',
		id: 'id',
		provider: 'provider'
	}
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

const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeFormData(entries: Record<string, string>): FormData {
	const fd = new FormData()
	for (const [k, v] of Object.entries(entries)) fd.set(k, v)
	return fd
}

/* ── connectForgejo ───────────────────────────────────────────────── */

describe('connectForgejo', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns 400 when instanceUrl is missing', async () => {
		const result = await connectForgejo(makeFormData({ token: 'tok' }))
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { forgejoError: string } }).data.forgejoError).toContain(
			'Instance URL is required'
		)
	})

	it('returns 400 when token is missing', async () => {
		const result = await connectForgejo(makeFormData({ instanceUrl: 'https://codeberg.org' }))
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { forgejoError: string } }).data.forgejoError).toContain(
			'API token is required'
		)
	})

	it('returns 400 when instanceUrl is not a valid URL', async () => {
		const result = await connectForgejo(makeFormData({ instanceUrl: 'not-a-url', token: 'tok' }))
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { forgejoError: string } }).data.forgejoError).toContain(
			'Invalid URL format'
		)
	})

	it('returns 400 when verifyForgejoToken fails', async () => {
		vi.mocked(verifyForgejoToken).mockRejectedValueOnce(new Error('Unauthorized'))
		const result = await connectForgejo(
			makeFormData({ instanceUrl: 'https://codeberg.org', token: 'bad-token' })
		)
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { forgejoError: string } }).data.forgejoError).toContain(
			'Could not connect'
		)
	})

	it('inserts a new connection when none exists', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValueOnce({
			login: 'myuser',
			avatar_url: 'https://codeberg.org/avatar/myuser'
		} as Awaited<ReturnType<typeof verifyForgejoToken>>)

		/* No existing connection */
		mockDb.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		})
		const valuesMock = vi.fn().mockResolvedValue(undefined)
		mockDb.__insertMock.mockReturnValueOnce({ values: valuesMock })

		const result = await connectForgejo(
			makeFormData({ instanceUrl: 'https://codeberg.org', token: 'good-token' })
		)

		expect(result).toEqual({ forgejoConnected: true, accountName: 'myuser' })
		expect(valuesMock).toHaveBeenCalled()
	})

	it('updates an existing connection', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValueOnce({
			login: 'myuser',
			avatar_url: 'https://codeberg.org/avatar/myuser'
		} as Awaited<ReturnType<typeof verifyForgejoToken>>)

		/* Existing connection found */
		mockDb.__selectMock.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'conn-1' }])
				})
			})
		})
		const whereMock = vi.fn().mockResolvedValue(undefined)
		const setMock = vi.fn().mockReturnValue({ where: whereMock })
		mockDb.__updateMock.mockReturnValueOnce({ set: setMock })

		const result = await connectForgejo(
			makeFormData({ instanceUrl: 'https://codeberg.org/', token: 'good-token' })
		)

		expect(result).toEqual({ forgejoConnected: true, accountName: 'myuser' })
		expect(setMock).toHaveBeenCalled()
		/* Trailing slash should be stripped */
		expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ instanceUrl: 'https://codeberg.org' }))
	})
})

/* ── saveGithubApp ────────────────────────────────────────────────── */

describe('saveGithubApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns 400 when any field is missing', async () => {
		const result = await saveGithubApp(makeFormData({ appId: '123' }))
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { githubAppError: string } }).data.githubAppError).toContain(
			'All fields are required'
		)
	})

	it('saves all GitHub App settings and returns success', async () => {
		const result = await saveGithubApp(
			makeFormData({
				appId: '12345',
				privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
				clientId: 'Iv1.abc',
				clientSecret: 'super-secret'
			})
		)
		expect(result).toEqual({ githubAppSaved: true })
		expect(setSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('github_app_id', '12345')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_id', 'Iv1.abc')
	})
})

/* ── saveGitlabApp ────────────────────────────────────────────────── */

describe('saveGitlabApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns 400 when any field is missing', async () => {
		const result = await saveGitlabApp(makeFormData({ instanceUrl: 'https://gitlab.com' }))
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { gitlabAppError: string } }).data.gitlabAppError).toContain(
			'All fields are required'
		)
	})

	it('returns 400 when instanceUrl is not a valid URL', async () => {
		const result = await saveGitlabApp(
			makeFormData({ instanceUrl: 'not-a-url', applicationId: 'app-id', secret: 'sec' })
		)
		expect(result).toMatchObject({ status: 400 })
		expect((result as { data: { gitlabAppError: string } }).data.gitlabAppError).toContain(
			'Invalid URL format'
		)
	})

	it('saves all GitLab App settings and strips trailing slash', async () => {
		const result = await saveGitlabApp(
			makeFormData({
				instanceUrl: 'https://gitlab.example.com/',
				applicationId: 'my-app-id',
				secret: 'my-secret'
			})
		)
		expect(result).toEqual({ gitlabAppSaved: true })
		expect(setSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith(
			'gitlab_instance_url',
			'https://gitlab.example.com'
		)
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_id', 'my-app-id')
	})
})
