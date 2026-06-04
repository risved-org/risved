import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockGetSetting, mockDecrypt, mockGetGitLabAuthUrl } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), delete: vi.fn() },
	mockGetSetting: vi.fn(),
	mockDecrypt: vi.fn((v: string) => `dec:${v}`),
	mockGetGitLabAuthUrl: vi.fn(() => 'https://gitlab.com/oauth/authorize?...')
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/crypto', () => ({ decrypt: mockDecrypt }))
vi.mock('$lib/server/gitlab', () => ({ getGitLabAuthUrl: mockGetGitLabAuthUrl }))
vi.mock('$env/dynamic/private', () => ({ env: { CALLBACK_SECRET: 'test-secret' } }))
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

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue(rows)
		})
	}
}

function makeEvent(method: string, options: { body?: unknown; searchParams?: Record<string, string>; cookies?: Record<string, string | undefined> } = {}) {
	const url = new URL('http://localhost/')
	for (const [k, v] of Object.entries(options.searchParams ?? {})) url.searchParams.set(k, v)
	const cookies = options.cookies ?? {}
	return {
		request: new Request(url.toString(), {
			method,
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined
		}),
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

describe('GET /api/git/gitlab — list connections', () => {
	it('returns list of gitlab connections', async () => {
		mockGetSetting.mockResolvedValue(null)
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'c1', provider: 'gitlab', accountName: 'alice' }]))

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent('GET') as never)
		const data = await resp.json()
		expect(Array.isArray(data)).toBe(true)
	})
})

describe('GET /api/git/gitlab — ?action=connect proxy mode', () => {
	it('redirects to risved proxy when no custom creds', async () => {
		mockGetSetting.mockResolvedValue(null) // gitlab_app_mode → null (proxy)

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent('GET', { searchParams: { action: 'connect' } }) as never)
		).rejects.toMatchObject({ status: 302, location: expect.stringContaining('risved.com') })
	})

	it('sets redirect cookie when returnTo is provided', async () => {
		mockGetSetting.mockResolvedValue(null)

		const event = makeEvent('GET', { searchParams: { action: 'connect', redirect: '/settings/git' } })
		try {
			await (await import('./+server')).GET(event as never)
		} catch {
			/* expected redirect */
		}

		expect(event.cookies.set).toHaveBeenCalledWith(
			'gitlab_oauth_redirect',
			'/settings/git',
			expect.any(Object)
		)
	})

	it('does not set redirect cookie when returnTo is absent', async () => {
		mockGetSetting.mockResolvedValue(null)

		const event = makeEvent('GET', { searchParams: { action: 'connect' } })
		try {
			await (await import('./+server')).GET(event as never)
		} catch {
			/* expected redirect */
		}

		expect(event.cookies.set).not.toHaveBeenCalledWith('gitlab_oauth_redirect', expect.anything(), expect.anything())
	})
})

describe('GET /api/git/gitlab — ?action=connect custom mode', () => {
	it('redirects to GitLab OAuth in custom mode', async () => {
		mockGetSetting
			.mockResolvedValueOnce('custom') // gitlab_app_mode
			.mockResolvedValueOnce('my-client-id') // gitlab_client_id
			.mockResolvedValueOnce('enc-secret') // gitlab_client_secret
			.mockResolvedValueOnce('https://gitlab.example.com') // gitlab_instance_url

		const { GET } = await import('./+server')
		await expect(
			GET(makeEvent('GET', { searchParams: { action: 'connect' } }) as never)
		).rejects.toMatchObject({ status: 302, location: expect.stringContaining('gitlab.com') })
	})
})

describe('DELETE /api/git/gitlab', () => {
	it('returns 400 when body is invalid JSON', async () => {
		const event = {
			...makeEvent('DELETE'),
			request: new Request('http://localhost/', { method: 'DELETE', body: 'not-json' })
		}

		const { DELETE } = await import('./+server')
		const resp = await DELETE(event as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when connectionId is missing', async () => {
		const { DELETE } = await import('./+server')
		const resp = await DELETE(makeEvent('DELETE', { body: {} }) as never)
		expect(resp.status).toBe(400)
	})

	it('deletes the connection and returns success', async () => {
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const { DELETE } = await import('./+server')
		const resp = await DELETE(makeEvent('DELETE', { body: { connectionId: 'conn-1' } }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true })
	})
})
