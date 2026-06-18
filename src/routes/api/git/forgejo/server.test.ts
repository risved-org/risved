import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockVerifyForgejoToken, mockEncrypt } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	mockVerifyForgejoToken: vi.fn(),
	mockEncrypt: vi.fn((v: string) => `enc:${v}`)
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accountName: 'account_name' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
	and: vi.fn((...args: unknown[]) => args)
}))
vi.mock('$lib/server/forgejo', () => ({ verifyForgejoToken: mockVerifyForgejoToken }))
vi.mock('$lib/server/crypto', () => ({ encrypt: mockEncrypt }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown) => new Response(JSON.stringify(body), { status: 200 }))
}))

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue(rows)
		})
	}
}

function makeEvent(method: string, body?: unknown, params?: Record<string, string>) {
	return {
		request: new Request('http://localhost/', {
			method,
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: params ?? {},
		url: new URL('http://localhost/')
	}
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/git/forgejo', () => {
	it('returns list of forgejo connections', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'c1', provider: 'forgejo' }]))

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent('GET') as never)
		const data = await resp.json()
		expect(Array.isArray(data)).toBe(true)
	})
})

describe('POST /api/git/forgejo', () => {
	it('returns 400 when body is invalid JSON', async () => {
		const { POST } = await import('./+server')
		const event = {
			...makeEvent('POST'),
			request: new Request('http://localhost/', {
				method: 'POST',
				body: 'not-json'
			})
		}
		const resp = await POST(event as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when fields are missing', async () => {
		const { POST } = await import('./+server')
		const resp = await POST(makeEvent('POST', { instanceUrl: 'https://git.example.com' }) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 401 when token verification fails', async () => {
		mockVerifyForgejoToken.mockRejectedValue(new Error('bad token'))
		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent('POST', { instanceUrl: 'https://git.example.com', token: 'bad' }) as never
		)
		expect(resp.status).toBe(401)
	})

	it('inserts a new connection successfully', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: 'https://a.co/a.png' })
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent('POST', { instanceUrl: 'https://git.example.com', token: 'tok' }) as never
		)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true, accountName: 'alice' })
	})

	it('updates an existing connection', async () => {
		mockVerifyForgejoToken.mockResolvedValue({ login: 'alice', avatar_url: '' })
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

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent('POST', { instanceUrl: 'https://git.example.com', token: 'tok' }) as never
		)
		expect(resp.status).toBe(200)
		expect(mockDb.update).toHaveBeenCalled()
	})
})

describe('DELETE /api/git/forgejo', () => {
	it('returns 400 when body is invalid', async () => {
		const { DELETE } = await import('./+server')
		const resp = await DELETE(makeEvent('DELETE', {}) as never)
		expect(resp.status).toBe(400)
	})

	it('deletes the connection', async () => {
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const { DELETE } = await import('./+server')
		const resp = await DELETE(makeEvent('DELETE', { connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true })
	})
})
