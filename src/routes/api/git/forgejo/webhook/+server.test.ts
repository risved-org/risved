import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockCreateWebhook, mockSafeDecrypt, mockGetSetting } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockCreateWebhook: vi.fn(),
	mockSafeDecrypt: vi.fn((v: string) => `dec:${v}`),
	mockGetSetting: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id' },
	projects: { id: 'id' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/forgejo', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ForgejoClient: vi.fn().mockImplementation(function (this: any) {
		this.createWebhook = mockCreateWebhook
	})
}))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
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
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	}
}

function makeEvent(body: unknown) {
	return {
		request: new Request('http://localhost/', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/')
	}
}

const VALID_BODY = {
	connectionId: 'conn-1',
	projectId: 'proj-1',
	owner: 'alice',
	repo: 'myrepo',
	instanceUrl: 'https://git.example.com'
}

beforeEach(() => {
	vi.clearAllMocks()
	mockGetSetting.mockResolvedValue(null)
})

describe('POST /api/git/forgejo/webhook', () => {
	it('returns 400 when body is invalid JSON', async () => {
		const { POST } = await import('./+server')
		const event = {
			...makeEvent(null),
			request: new Request('http://localhost/', { method: 'POST', body: 'bad' })
		}
		const resp = await POST(event as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when required fields are missing', async () => {
		const { POST } = await import('./+server')
		const resp = await POST(makeEvent({ connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 404 when connection not found', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([]))

		const { POST } = await import('./+server')
		const resp = await POST(makeEvent(VALID_BODY) as never)
		expect(resp.status).toBe(404)
	})

	it('returns 404 when project not found', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([]))

		const { POST } = await import('./+server')
		const resp = await POST(makeEvent(VALID_BODY) as never)
		expect(resp.status).toBe(404)
	})

	it('returns 400 when project has no webhook secret', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([{ id: 'proj-1', webhookSecret: null }]))

		const { POST } = await import('./+server')
		const resp = await POST(makeEvent(VALID_BODY) as never)
		expect(resp.status).toBe(400)
	})

	it('creates webhook and returns success', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([{ id: 'proj-1', webhookSecret: 'sec' }]))
		mockCreateWebhook.mockResolvedValue({ id: 99 })

		const { POST } = await import('./+server')
		const resp = await POST(makeEvent(VALID_BODY) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true, webhookId: 99 })
	})

	it('uses hostname setting when available', async () => {
		mockGetSetting.mockResolvedValue('example.com')
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([{ id: 'proj-1', webhookSecret: 'sec' }]))
		mockCreateWebhook.mockResolvedValue({ id: 10 })

		const { POST } = await import('./+server')
		await POST(makeEvent(VALID_BODY) as never)

		expect(mockCreateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ webhookUrl: 'https://example.com/api/webhooks/proj-1' })
		)
	})
})
