import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockGetSetting, mockEncrypt, mockDecrypt, mockDecryptCallbackToken, mockExchangeCode, mockGetUser } = vi.hoisted(() => {
	const mockGetUser = vi.fn().mockResolvedValue({ login: 'alice', avatar_url: 'https://a.co/a.png' })
	return {
		mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
		mockGetSetting: vi.fn(),
		mockEncrypt: vi.fn((v: string) => `enc:${v}`),
		mockDecrypt: vi.fn((v: string) => `dec:${v}`),
		mockDecryptCallbackToken: vi.fn((v: string) => `tok:${v}`),
		mockExchangeCode: vi.fn().mockResolvedValue({ access_token: 'gh-token' }),
		mockGetUser
	}
})

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/crypto', () => ({
	encrypt: mockEncrypt,
	decrypt: mockDecrypt,
	decryptCallbackToken: mockDecryptCallbackToken
}))
vi.mock('$lib/server/github', () => ({
	exchangeGitHubCode: mockExchangeCode,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitHubClient: vi.fn().mockImplementation(function (this: any) {
		this.getUser = mockGetUser
	})
}))
vi.mock('$env/dynamic/private', () => ({ env: { CALLBACK_SECRET: 'test-secret' } }))
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

function makeSelectWithLimit(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	}
}

function makeEvent(searchParams: Record<string, string>, cookies: Record<string, string | undefined> = {}) {
	const url = new URL('http://localhost/')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		request: new Request(url.toString()),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url,
		cookies: {
			set: vi.fn(),
			get: vi.fn((k: string) => cookies[k]),
			delete: vi.fn()
		}
	}
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/git/github/callback — proxy mode', () => {
	it('returns 400 when token param is missing', async () => {
		mockGetSetting.mockResolvedValue(null) // mode = proxy

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({}) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when token decryption fails', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDecryptCallbackToken.mockImplementationOnce(() => { throw new Error('bad') })

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ token: 'bad-token' }) as never)
		expect(resp.status).toBe(400)
	})

	it('inserts new connection and redirects', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ token: 'enc-tok' }) as never)).rejects.toMatchObject({
			status: 302,
			location: '/settings/git'
		})
		expect(mockDb.insert).toHaveBeenCalled()
	})

	it('updates existing connection and redirects', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.select.mockReturnValue(makeSelectWithLimit([{ id: 'conn-1' }]))
		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		})

		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ token: 'enc-tok' }) as never)).rejects.toMatchObject({
			status: 302
		})
		expect(mockDb.update).toHaveBeenCalled()
	})

	it('redirects to returnTo cookie path', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const event = makeEvent({ token: 'enc-tok' }, { github_oauth_redirect: '/onboarding/git' })
		const { GET } = await import('./+server')
		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: '/onboarding/git'
		})
	})
})

describe('GET /api/git/github/callback — custom mode', () => {
	it('returns 400 when state is missing or mismatched', async () => {
		mockGetSetting.mockResolvedValue('custom')

		const { GET } = await import('./+server')
		const resp = await GET(
			makeEvent({ code: 'abc', state: 'x' }, { github_oauth_state: 'y' }) as never
		)
		expect(resp.status).toBe(400)
	})

	it('returns 500 when custom app credentials not configured', async () => {
		mockGetSetting
			.mockResolvedValueOnce('custom')  // mode
			.mockResolvedValueOnce(null)       // client_id
			.mockResolvedValueOnce(null)       // client_secret

		const { GET } = await import('./+server')
		const resp = await GET(
			makeEvent({ code: 'abc', state: 'my-state' }, { github_oauth_state: 'my-state' }) as never
		)
		expect(resp.status).toBe(500)
	})

	it('exchanges code and inserts connection', async () => {
		mockGetSetting
			.mockResolvedValueOnce('custom')          // mode
			.mockResolvedValueOnce('client-id')        // client_id
			.mockResolvedValueOnce('enc-secret')       // client_secret
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent({ code: 'auth-code', state: 'st' }, { github_oauth_state: 'st' }) as never)
		).rejects.toMatchObject({ status: 302 })
		expect(mockExchangeCode).toHaveBeenCalledWith('client-id', 'dec:enc-secret', 'auth-code')
	})
})
