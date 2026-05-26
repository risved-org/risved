import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn()
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: {
		id: 'id',
		provider: 'provider',
		accountName: 'account_name',
		instanceUrl: 'instance_url',
		accessToken: 'access_token',
		avatarUrl: 'avatar_url',
		updatedAt: 'updated_at'
	},
	settings: { key: 'key', value: 'value' }
}))

vi.mock('$lib/server/forgejo', () => ({
	verifyForgejoToken: vi.fn()
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn().mockReturnValue('encrypted-token')
}))

vi.mock('$lib/server/settings', () => ({
	setSetting: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue(makeSelectChain(rows))
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('connectForgejo', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns error when instanceUrl is missing', async () => {
		const { connectForgejo } = await import('./git-actions')
		const fd = new FormData()
		fd.set('token', 'tok')
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('returns error when token is missing', async () => {
		const { connectForgejo } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'https://forgejo.example.com')
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('returns error for invalid URL format', async () => {
		const { connectForgejo } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'not-a-url')
		fd.set('token', 'tok')
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('returns error when token verification fails', async () => {
		const { verifyForgejoToken } = await import('$lib/server/forgejo')
		vi.mocked(verifyForgejoToken).mockRejectedValue(new Error('auth failed'))
		setupSelect([])

		const { connectForgejo } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'https://forgejo.example.com')
		fd.set('token', 'bad-token')
		const result = await connectForgejo(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('inserts a new connection when none exists', async () => {
		const { verifyForgejoToken } = await import('$lib/server/forgejo')
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'alice', avatar_url: 'https://img' } as never)
		setupSelect([])

		mockDb.insert.mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined)
		})

		const { connectForgejo } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'https://forgejo.example.com')
		fd.set('token', 'good-token')
		const result = await connectForgejo(fd)
		expect((result as { forgejoConnected: boolean }).forgejoConnected).toBe(true)
		expect((result as { accountName: string }).accountName).toBe('alice')
	})

	it('updates an existing connection when one exists', async () => {
		const { verifyForgejoToken } = await import('$lib/server/forgejo')
		vi.mocked(verifyForgejoToken).mockResolvedValue({ login: 'alice', avatar_url: 'https://img' } as never)
		setupSelect([{ id: 'conn-1', accountName: 'alice' }])

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		})

		const { connectForgejo } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'https://forgejo.example.com')
		fd.set('token', 'good-token')
		const result = await connectForgejo(fd)
		expect((result as { forgejoConnected: boolean }).forgejoConnected).toBe(true)
		expect(mockDb.update).toHaveBeenCalled()
	})
})

describe('saveGithubApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns error when any field is missing', async () => {
		const { saveGithubApp } = await import('./git-actions')
		const fd = new FormData()
		fd.set('appId', '123')
		const result = await saveGithubApp(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('saves all github app settings', async () => {
		const { setSetting } = await import('$lib/server/settings')
		const { saveGithubApp } = await import('./git-actions')
		const fd = new FormData()
		fd.set('appId', '123')
		fd.set('privateKey', 'pem-key')
		fd.set('clientId', 'cid')
		fd.set('clientSecret', 'csec')
		const result = await saveGithubApp(fd)
		expect((result as { githubAppSaved: boolean }).githubAppSaved).toBe(true)
		expect(setSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
	})
})

describe('saveGitlabApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns error when any field is missing', async () => {
		const { saveGitlabApp } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'https://gitlab.example.com')
		const result = await saveGitlabApp(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('returns error for invalid instance URL', async () => {
		const { saveGitlabApp } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'not-a-url')
		fd.set('applicationId', 'app-id')
		fd.set('secret', 'sec')
		const result = await saveGitlabApp(fd)
		expect((result as { status: number }).status).toBe(400)
	})

	it('saves all gitlab app settings', async () => {
		const { setSetting } = await import('$lib/server/settings')
		const { saveGitlabApp } = await import('./git-actions')
		const fd = new FormData()
		fd.set('instanceUrl', 'https://gitlab.example.com')
		fd.set('applicationId', 'app-id')
		fd.set('secret', 'sec')
		const result = await saveGitlabApp(fd)
		expect((result as { gitlabAppSaved: boolean }).gitlabAppSaved).toBe(true)
		expect(setSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
	})
})
