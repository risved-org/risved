import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockGetSetting, mockEncrypt, mockDecrypt, mockDecryptCallbackToken, mockExchangeCode, mockGetUser } = vi.hoisted(() => {
	const mockGetUser = vi.fn().mockResolvedValue({ username: 'alice', avatar_url: 'https://a.co/a.png' })
	return {
		mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
		mockGetSetting: vi.fn(),
		mockEncrypt: vi.fn((v: string) => `enc:${v}`),
		mockDecrypt: vi.fn((v: string) => `dec:${v}`),
		mockDecryptCallbackToken: vi.fn((v: string) => `tok:${v}`),
		mockExchangeCode: vi.fn().mockResolvedValue({
			access_token: 'gl-token',
			refresh_token: 'gl-refresh',
			expires_in: 7200
		}),
		mockGetUser
	}
})

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
	and: vi.fn((...args: unknown[]) => args)
}))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/crypto', () => ({
	encrypt: mockEncrypt,
	decrypt: mockDecrypt,
	decryptCallbackToken: mockDecryptCallbackToken
}))
vi.mock('$lib/server/gitlab', () => ({
	exchangeGitLabCode: mockExchangeCode,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitLabClient: vi.fn().mockImplementation(function (this: any) {
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

describe('GET /api/git/gitlab/callback — proxy mode', () => {
	it('returns 400 when token param is missing', async () => {
		mockGetSetting.mockResolvedValue(null)

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

	it('decrypts optional refresh token from query params', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent({ token: 'enc-tok', refresh_token: 'enc-refresh', expires_in: '3600' }) as never)
		).rejects.toMatchObject({ status: 302 })
		expect(mockDecryptCallbackToken).toHaveBeenCalledWith('enc-refresh', 'test-secret')
	})

	it('redirects to returnTo cookie path', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const event = makeEvent({ token: 'enc-tok' }, { gitlab_oauth_redirect: '/onboarding/git' })
		const { GET } = await import('./+server')
		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: '/onboarding/git'
		})
	})
})

describe('GET /api/git/gitlab/callback — custom mode', () => {
	it('returns 400 when state is missing or mismatched', async () => {
		mockGetSetting.mockResolvedValue('custom')

		const { GET } = await import('./+server')
		const resp = await GET(
			makeEvent({ code: 'abc', state: 'x' }, { gitlab_oauth_state: 'y' }) as never
		)
		expect(resp.status).toBe(400)
	})

	it('returns 500 when custom app credentials not configured', async () => {
		mockGetSetting
			.mockResolvedValueOnce('custom')   // mode
			.mockResolvedValueOnce(null)        // client_id
			.mockResolvedValueOnce(null)        // client_secret
			.mockResolvedValueOnce(null)        // instance_url

		const { GET } = await import('./+server')
		const resp = await GET(
			makeEvent({ code: 'abc', state: 'my-state' }, { gitlab_oauth_state: 'my-state' }) as never
		)
		expect(resp.status).toBe(500)
	})

	it('exchanges code and inserts connection', async () => {
		mockGetSetting
			.mockResolvedValueOnce('custom')
			.mockResolvedValueOnce('client-id')
			.mockResolvedValueOnce('enc-secret')
			.mockResolvedValueOnce('https://gitlab.example.com')
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent({ code: 'auth-code', state: 'st' }, { gitlab_oauth_state: 'st' }) as never)
		).rejects.toMatchObject({ status: 302 })
		expect(mockExchangeCode).toHaveBeenCalledWith(
			'client-id',
			'dec:enc-secret',
			'auth-code',
			expect.any(String),
			'https://gitlab.example.com'
		)
	})
})
