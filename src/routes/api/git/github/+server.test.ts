import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEnv = { CALLBACK_SECRET: 'test-secret' }

const { mockDb, mockGetSetting, mockDecrypt, mockGetGitHubAuthUrl } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), delete: vi.fn() },
	mockGetSetting: vi.fn(),
	mockDecrypt: vi.fn((v: string) => `dec:${v}`),
	mockGetGitHubAuthUrl: vi.fn(() => 'https://github.com/login/oauth/authorize?test')
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/github', () => ({ getGitHubAuthUrl: mockGetGitHubAuthUrl }))
vi.mock('$lib/server/crypto', () => ({ decrypt: mockDecrypt }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown) => new Response(JSON.stringify(body), { status: 200 })),
	redirect: vi.fn((status: number, location: string) => {
		throw Object.assign(new Error('redirect'), { status, location })
	})
}))
vi.mock('$env/dynamic/private', () => ({ get env() { return mockEnv } }))

function makeEvent(searchParams: Record<string, string> = {}, body?: unknown) {
	const url = new URL('http://localhost/api/git/github')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		request: new Request(url.toString(), {
			method: body !== undefined ? 'DELETE' : 'GET',
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		url,
		cookies: { set: vi.fn(), get: vi.fn(), delete: vi.fn() }
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	mockEnv.CALLBACK_SECRET = 'test-secret'
	mockGetSetting.mockResolvedValue(null)
})

describe('GET /api/git/github — list connections', () => {
	it('returns list of github connections', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ id: 'c1', provider: 'github' }])
			})
		})

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent() as never)
		const data = await resp.json()
		expect(Array.isArray(data)).toBe(true)
		expect(data[0].id).toBe('c1')
	})
})

describe('GET /api/git/github — connect (proxy mode)', () => {
	it('redirects to risved.com proxy when no custom creds', async () => {
		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ action: 'connect' }) as never)).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('risved.com/callback/github/start')
		})
	})

	it('sets redirect cookie when returnTo param provided', async () => {
		const { GET } = await import('./+server')
		const event = makeEvent({ action: 'connect', redirect: '/settings/git' })
		try {
			await GET(event as never)
		} catch { /* expected */ }
		expect(event.cookies.set).toHaveBeenCalledWith(
			'github_oauth_redirect',
			'/settings/git',
			expect.any(Object)
		)
	})

	it('returns 500 when CALLBACK_SECRET is missing', async () => {
		mockEnv.CALLBACK_SECRET = ''
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ action: 'connect' }) as never)
		expect(resp.status).toBe(500)
	})
})

describe('GET /api/git/github — connect (custom mode)', () => {
	it('redirects to GitHub OAuth when custom creds are set', async () => {
		mockGetSetting.mockImplementation((key: string) => {
			if (key === 'github_app_mode') return Promise.resolve('custom')
			if (key === 'github_app_client_id') return Promise.resolve('my-client-id')
			if (key === 'github_app_client_secret') return Promise.resolve('enc:my-secret')
			return Promise.resolve(null)
		})

		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ action: 'connect' }) as never)).rejects.toMatchObject({
			status: 302,
			location: 'https://github.com/login/oauth/authorize?test'
		})
		expect(mockGetGitHubAuthUrl).toHaveBeenCalledWith('my-client-id', expect.any(String), expect.any(String))
	})

	it('falls through to proxy mode when clientId or secret are missing', async () => {
		mockGetSetting.mockImplementation((key: string) => {
			if (key === 'github_app_mode') return Promise.resolve('custom')
			return Promise.resolve(null)
		})

		const { GET } = await import('./+server')
		await expect(GET(makeEvent({ action: 'connect' }) as never)).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('risved.com')
		})
	})
})

describe('DELETE /api/git/github', () => {
	it('returns 400 when body is invalid JSON', async () => {
		const { DELETE } = await import('./+server')
		const event = {
			...makeEvent(),
			request: new Request('http://localhost/', { method: 'DELETE', body: 'not-json' })
		}
		const resp = await DELETE(event as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when connectionId is missing', async () => {
		const { DELETE } = await import('./+server')
		const resp = await DELETE(makeEvent({}, {}) as never)
		expect(resp.status).toBe(400)
	})

	it('deletes connection and returns success', async () => {
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const { DELETE } = await import('./+server')
		const resp = await DELETE(makeEvent({}, { connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true })
		expect(mockDb.delete).toHaveBeenCalled()
	})
})
