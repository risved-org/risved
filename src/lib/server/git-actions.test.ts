import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockVerifyForgejoToken, mockEncrypt, mockSetSetting } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
	mockVerifyForgejoToken: vi.fn(),
	mockEncrypt: vi.fn((v: string) => `enc:${v}`),
	mockSetSetting: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/forgejo', () => ({ verifyForgejoToken: mockVerifyForgejoToken }))
vi.mock('$lib/server/crypto', () => ({ encrypt: mockEncrypt }))
vi.mock('$lib/server/settings', () => ({ setSetting: mockSetSetting }))
vi.mock('@sveltejs/kit', () => ({
	fail: vi.fn((status: number, data: unknown) => ({ status, data }))
}))

import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'

function makeFormData(fields: Record<string, string>) {
	const fd = new FormData()
	for (const [k, v] of Object.entries(fields)) fd.append(k, v)
	return fd
}

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	}
}

function makeInsertChain() {
	return { values: vi.fn().mockResolvedValue(undefined) }
}

function makeUpdateChain() {
	return { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }
}

beforeEach(() => vi.clearAllMocks())

/* ── connectForgejo ────────────────────────────────────────────────── */

describe('connectForgejo', () => {
	it('fails with 400 when instanceUrl is missing', async () => {
		const fd = makeFormData({ token: 'tok' })
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('fails with 400 when token is missing', async () => {
		const fd = makeFormData({ instanceUrl: 'https://git.example.com' })
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('fails with 400 on invalid URL', async () => {
		const fd = makeFormData({ instanceUrl: 'not-a-url', token: 'tok' })
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('fails with 400 when verifyForgejoToken throws', async () => {
		mockVerifyForgejoToken.mockRejectedValue(new Error('network'))
		const fd = makeFormData({ instanceUrl: 'https://git.example.com', token: 'tok' })
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('inserts a new connection when none exists', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://a.co/a.png' })
		mockDb.select.mockReturnValue(makeSelectChain([]))
		mockDb.insert.mockReturnValue(makeInsertChain())

		const fd = makeFormData({ instanceUrl: 'https://git.example.com', token: 'tok' })
		const result = await connectForgejo(fd)

		expect(mockDb.insert).toHaveBeenCalled()
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('updates an existing connection', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://a.co/a.png' })
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1' }]))
		mockDb.update.mockReturnValue(makeUpdateChain())

		const fd = makeFormData({ instanceUrl: 'https://git.example.com/', token: 'tok' })
		const result = await connectForgejo(fd)

		expect(mockDb.update).toHaveBeenCalled()
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('strips trailing slash from instanceUrl', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: '' })
		mockDb.select.mockReturnValue(makeSelectChain([]))
		const insertValues = vi.fn().mockResolvedValue(undefined)
		mockDb.insert.mockReturnValue({ values: insertValues })

		const fd = makeFormData({ instanceUrl: 'https://git.example.com///', token: 'tok' })
		await connectForgejo(fd)

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ instanceUrl: 'https://git.example.com' })
		)
	})
})

/* ── saveGithubApp ─────────────────────────────────────────────────── */

describe('saveGithubApp', () => {
	it('fails with 400 when any field is missing', async () => {
		const fd = makeFormData({ appId: '123', privateKey: 'pk', clientId: 'cid' })
		const result = await saveGithubApp(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('saves all settings when all fields provided', async () => {
		mockSetSetting.mockResolvedValue(undefined)
		const fd = makeFormData({
			appId: '123',
			privateKey: 'pk',
			clientId: 'cid',
			clientSecret: 'sec'
		})
		const result = await saveGithubApp(fd)

		expect(mockSetSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_id', '123')
		expect(mockSetSetting).toHaveBeenCalledWith('github_app_client_id', 'cid')
		expect(result).toMatchObject({ githubAppSaved: true })
	})
})

/* ── saveGitlabApp ─────────────────────────────────────────────────── */

describe('saveGitlabApp', () => {
	it('fails with 400 when any field is missing', async () => {
		const fd = makeFormData({ instanceUrl: 'https://gitlab.com', applicationId: 'aid' })
		const result = await saveGitlabApp(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('fails with 400 on invalid URL', async () => {
		const fd = makeFormData({ instanceUrl: 'not-a-url', applicationId: 'aid', secret: 'sec' })
		const result = await saveGitlabApp(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('saves all settings when all fields provided', async () => {
		mockSetSetting.mockResolvedValue(undefined)
		const fd = makeFormData({
			instanceUrl: 'https://gitlab.example.com/',
			applicationId: 'aid',
			secret: 'sec'
		})
		const result = await saveGitlabApp(fd)

		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.example.com')
		expect(mockSetSetting).toHaveBeenCalledWith('gitlab_client_id', 'aid')
		expect(result).toMatchObject({ gitlabAppSaved: true })
	})
})
