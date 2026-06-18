import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEnv = { CALLBACK_SECRET: 'test-secret' }

const {
	mockDb,
	mockGetSetting,
	mockEncrypt,
	mockDecrypt,
	mockDecryptCallbackToken,
	mockExchangeGitHubCode,
	mockGetUser
} = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
	mockGetSetting: vi.fn(),
	mockEncrypt: vi.fn((v: string) => `enc:${v}`),
	mockDecrypt: vi.fn((v: string) => `dec:${v}`),
	mockDecryptCallbackToken: vi.fn((v: string) => `tok:${v}`),
	mockExchangeGitHubCode: vi.fn(),
	mockGetUser: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/crypto', () => ({
	encrypt: mockEncrypt,
	decrypt: mockDecrypt,
	decryptCallbackToken: mockDecryptCallbackToken
}))
vi.mock('$lib/server/github', () => ({
	exchangeGitHubCode: mockExchangeGitHubCode,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitHubClient: vi.fn().mockImplementation(function (this: any) {
		this.getUser = mockGetUser
	})
}))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('@sveltejs/kit', () => ({
	redirect: vi.fn((status: number, location: string) => {
		throw Object.assign(new Error('redirect'), { status, location })
	})
}))
vi.mock('$env/dynamic/private', () => ({ get env() { return mockEnv } }))

function makeEvent(searchParams: Record<string, string> = {}, cookies: Record<string, string> = {}) {
	const url = new URL('http://localhost/api/git/github/callback')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		request: new Request(url.toString()),
		locals: { user: { id: 'user-1' }, session: {} },
		url,
		cookies: {
			set: vi.fn(),
			get: vi.fn((key: string) => cookies[key] ?? null),
			delete: vi.fn()
		}
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	mockEnv.CALLBACK_SECRET = 'test-secret'
	mockGetSetting.mockResolvedValue(null)
	mockGetUser.mockResolvedValue({ login: 'alice', avatar_url: 'https://a.co/a.png' })
})

describe('GET /api/git/github/callback — proxy mode', () => {
	it('returns 400 when token param is missing', async () => {
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent() as never)
		expect(resp.status).toBe(400)
	})

	it('returns 500 when CALLBACK_SECRET is missing', async () => {
		mockEnv.CALLBACK_SECRET = ''
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ token: 'enc-token' }) as never)
		expect(resp.status).toBe(500)
	})

	it('returns 400 when token decryption fails', async () => {
		mockDecryptCallbackToken.mockImplementationOnce(() => { throw new Error('bad token') })
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ token: 'bad-token' }) as never)
		expect(resp.status).toBe(400)
	})

	it('inserts new connection on successful proxy callback', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ token: 'enc-token' }) as never)).rejects.toMatchObject({
			status: 302,
			location: '/settings/git'
		})
		expect(mockDb.insert).toHaveBeenCalled()
	})

	it('updates existing connection on proxy callback', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'conn-1' }])
				})
			})
		})
		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		})

		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ token: 'enc-token' }) as never)).rejects.toMatchObject({
			status: 302
		})
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('uses redirect cookie as returnTo destination', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		})
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent({ token: 'tok' }, { github_oauth_redirect: '/settings' }) as never)
		).rejects.toMatchObject({ status: 302, location: '/settings' })
	})
})

describe('GET /api/git/github/callback — custom mode', () => {
	beforeEach(() => {
		mockGetSetting.mockImplementation((key: string) => {
			if (key === 'github_app_mode') return Promise.resolve('custom')
			if (key === 'github_app_client_id') return Promise.resolve('client-id')
			if (key === 'github_app_client_secret') return Promise.resolve('enc:secret')
			return Promise.resolve(null)
		})
	})

	it('returns 400 when state is missing', async () => {
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ code: 'auth-code' }) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when state does not match', async () => {
		const { GET } = await import('./+server')
		const resp = await GET(
			makeEvent({ code: 'auth-code', state: 'wrong' }, { github_oauth_state: 'correct' }) as never
		)
		expect(resp.status).toBe(400)
	})

	it('returns 500 when clientId or secret are missing', async () => {
		mockGetSetting.mockImplementation((key: string) => {
			if (key === 'github_app_mode') return Promise.resolve('custom')
			return Promise.resolve(null)
		})

		const { GET } = await import('./+server')
		const resp = await GET(
			makeEvent({ code: 'c', state: 'st' }, { github_oauth_state: 'st' }) as never
		)
		expect(resp.status).toBe(500)
	})

	it('exchanges code and inserts connection in custom mode', async () => {
		mockExchangeGitHubCode.mockResolvedValue({ access_token: 'gho_abc123' })
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		})
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent({ code: 'auth-code', state: 'mystate' }, { github_oauth_state: 'mystate' }) as never)
		).rejects.toMatchObject({ status: 302 })
		expect(mockExchangeGitHubCode).toHaveBeenCalled()
		expect(mockDb.insert).toHaveBeenCalled()
	})
})
