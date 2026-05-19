import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() }
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({ gitConnections: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('$lib/server/forgejo', () => ({ verifyForgejoToken: vi.fn() }))
vi.mock('$lib/server/crypto', () => ({ encrypt: vi.fn().mockReturnValue('enc-token') }))
vi.mock('$lib/server/settings', () => ({ setSetting: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@sveltejs/kit', () => ({ fail: vi.fn((status: number, data: unknown) => ({ status, data })) }))

import { verifyForgejoToken } from '$lib/server/forgejo'
import { setSetting } from '$lib/server/settings'
import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'

function makeFormData(fields: Record<string, string>) {
	const fd = new FormData()
	for (const [key, value] of Object.entries(fields)) {
		fd.append(key, value)
	}
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

function setupInsert() {
	mockDb.insert.mockReturnValue({
		values: vi.fn().mockResolvedValue(undefined)
	})
}

function setupUpdate() {
	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	})
}

describe('connectForgejo', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns fail(400) when instanceUrl is missing', async () => {
		const result = await connectForgejo(makeFormData({ token: 'mytoken' }))
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.any(String) } })
	})

	it('returns fail(400) when token is missing', async () => {
		const result = await connectForgejo(makeFormData({ instanceUrl: 'https://forgejo.example.com' }))
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.any(String) } })
	})

	it('returns fail(400) for invalid URL format', async () => {
		const result = await connectForgejo(makeFormData({ instanceUrl: 'not-a-url', token: 'mytoken' }))
		expect(result).toMatchObject({ status: 400, data: { forgejoError: 'Invalid URL format' } })
	})

	it('returns fail(400) when verifyForgejoToken throws', async () => {
		vi.mocked(verifyForgejoToken).mockRejectedValue(new Error('connection refused'))
		const result = await connectForgejo(makeFormData({ instanceUrl: 'https://forgejo.example.com', token: 'mytoken' }))
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.stringContaining('Could not connect') } })
	})

	it('inserts new connection when no existing one found', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'alice', avatar_url: 'https://example.com/avatar.png' } as never)
		setupSelect([])
		setupInsert()

		const result = await connectForgejo(makeFormData({ instanceUrl: 'https://forgejo.example.com', token: 'mytoken' }))
		expect(mockDb.insert).toHaveBeenCalled()
		expect(mockDb.update).not.toHaveBeenCalled()
		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
	})

	it('updates existing connection when already exists', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'alice', avatar_url: 'https://example.com/avatar.png' } as never)
		setupSelect([{ id: 42, accountName: 'alice' }])
		setupUpdate()

		const result = await connectForgejo(makeFormData({ instanceUrl: 'https://forgejo.example.com', token: 'mytoken' }))
		expect(mockDb.update).toHaveBeenCalled()
		expect(mockDb.insert).not.toHaveBeenCalled()
		expect(result).toEqual({ forgejoConnected: true, accountName: 'alice' })
	})

	it('returns { forgejoConnected: true, accountName } on success', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'bob', avatar_url: 'https://example.com/bob.png' } as never)
		setupSelect([])
		setupInsert()

		const result = await connectForgejo(makeFormData({ instanceUrl: 'https://forgejo.example.com/', token: 'tok' }))
		expect(result).toEqual({ forgejoConnected: true, accountName: 'bob' })
	})
})

describe('saveGithubApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns fail(400) when any field is missing', async () => {
		const cases = [
			{ privateKey: 'pk', clientId: 'cid', clientSecret: 'cs' },
			{ appId: 'aid', clientId: 'cid', clientSecret: 'cs' },
			{ appId: 'aid', privateKey: 'pk', clientSecret: 'cs' },
			{ appId: 'aid', privateKey: 'pk', clientId: 'cid' }
		]
		for (const fields of cases) {
			const result = await saveGithubApp(makeFormData(fields))
			expect(result).toMatchObject({ status: 400, data: { githubAppError: expect.any(String) } })
		}
	})

	it('calls setSetting for all 5 settings and returns { githubAppSaved: true }', async () => {
		const result = await saveGithubApp(makeFormData({
			appId: '123',
			privateKey: 'private-key-content',
			clientId: 'Iv1.abc',
			clientSecret: 'secret123'
		}))
		expect(setSetting).toHaveBeenCalledTimes(5)
		expect(setSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('github_app_id', '123')
		expect(setSetting).toHaveBeenCalledWith('github_app_private_key', 'enc-token')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_id', 'Iv1.abc')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_secret', 'enc-token')
		expect(result).toEqual({ githubAppSaved: true })
	})
})

describe('saveGitlabApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns fail(400) when any field is missing', async () => {
		const cases = [
			{ applicationId: 'aid', secret: 's' },
			{ instanceUrl: 'https://gitlab.example.com', secret: 's' },
			{ instanceUrl: 'https://gitlab.example.com', applicationId: 'aid' }
		]
		for (const fields of cases) {
			const result = await saveGitlabApp(makeFormData(fields))
			expect(result).toMatchObject({ status: 400, data: { gitlabAppError: expect.any(String) } })
		}
	})

	it('returns fail(400) for invalid instanceUrl', async () => {
		const result = await saveGitlabApp(makeFormData({
			instanceUrl: 'not-a-url',
			applicationId: 'aid',
			secret: 'secret'
		}))
		expect(result).toMatchObject({ status: 400, data: { gitlabAppError: 'Invalid URL format' } })
	})

	it('calls setSetting for all 4 settings and returns { gitlabAppSaved: true }', async () => {
		const result = await saveGitlabApp(makeFormData({
			instanceUrl: 'https://gitlab.example.com/',
			applicationId: 'app-id-123',
			secret: 'my-secret'
		}))
		expect(setSetting).toHaveBeenCalledTimes(4)
		expect(setSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.example.com')
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_id', 'app-id-123')
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_secret', 'enc-token')
		expect(result).toEqual({ gitlabAppSaved: true })
	})
})
