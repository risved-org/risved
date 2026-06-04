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
vi.mock('$lib/server/gitlab', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitLabClient: vi.fn().mockImplementation(function (this: any) {
		this.createWebhook = mockCreateWebhook
	})
}))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$env/dynamic/private', () => ({ env: { GITLAB_INSTANCE_URL: 'https://gitlab.com' } }))
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
		request: new Request('http://localhost/', { method: 'POST', body: JSON.stringify(body) }),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/')
	}
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/git/gitlab/webhook', () => {
	it('returns 400 when body is invalid JSON', async () => {
		const event = {
			request: new Request('http://localhost/', { method: 'POST', body: 'not-json' }),
			locals: { user: { id: 'user-1' }, session: {} },
			params: {},
			url: new URL('http://localhost/')
		}

		const { POST } = await import('./+server')
		const resp = await POST(event as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when required fields are missing', async () => {
		const { POST } = await import('./+server')
		const resp = await POST(makeEvent({ connectionId: 'c1' }) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 404 when connection not found', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([]))

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(404)
	})

	it('returns 404 when project not found', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'c1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([]))

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(404)
	})

	it('returns 400 when project has no webhook secret', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'c1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([{ id: 'p1', webhookSecret: null }]))
		mockGetSetting.mockResolvedValue(null)

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(400)
	})

	it('creates webhook and returns success', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'c1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([{ id: 'p1', webhookSecret: 'secret-123' }]))
		mockGetSetting.mockResolvedValue(null)
		mockCreateWebhook.mockResolvedValue({ id: 99 })

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true, webhookId: 99 })
	})

	it('uses hostname from settings when available', async () => {
		mockDb.select
			.mockReturnValueOnce(makeSelectChain([{ id: 'c1', accessToken: 'enc' }]))
			.mockReturnValueOnce(makeSelectChain([{ id: 'p1', webhookSecret: 'secret-123' }]))
		mockGetSetting.mockResolvedValue('my.instance.com')
		mockCreateWebhook.mockResolvedValue({ id: 100 })

		const { POST } = await import('./+server')
		await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(mockCreateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ webhookUrl: expect.stringContaining('my.instance.com') })
		)
	})
})
