import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockGetSetting, mockSafeDecrypt, mockCreateWebhook } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockGetSetting: vi.fn(),
	mockSafeDecrypt: vi.fn((v: string) => `dec:${v}`),
	mockCreateWebhook: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id' },
	projects: { id: 'id' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))
vi.mock('$lib/server/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
vi.mock('$lib/server/gitlab', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitLabClient: vi.fn().mockImplementation(function (this: any) {
		this.createWebhook = mockCreateWebhook
	})
}))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown) => new Response(JSON.stringify(body), { status: 200 }))
}))
vi.mock('$env/dynamic/private', () => ({ env: { GITLAB_INSTANCE_URL: '' } }))

function makeEvent(body?: unknown) {
	return {
		request: new Request('http://localhost/', {
			method: 'POST',
			body: body !== undefined ? JSON.stringify(body) : 'not-json',
			headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		url: new URL('http://localhost/')
	}
}

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) })
		})
	}
}

function setupDbMocks({
	connection = null as { id: string; accessToken: string } | null,
	project = null as { id: string; webhookSecret: string | null } | null
} = {}) {
	mockDb.select.mockReset()
	mockDb.select
		.mockReturnValueOnce(makeSelectChain(connection ? [connection] : []))
		.mockReturnValueOnce(makeSelectChain(project ? [project] : []))
}

beforeEach(() => {
	vi.clearAllMocks()
	mockGetSetting.mockResolvedValue(null)
})

describe('POST /api/git/gitlab/webhook', () => {
	it('returns 400 for invalid JSON body', async () => {
		const { POST } = await import('./+server')
		const resp = await POST(makeEvent() as never)
		expect(resp.status).toBe(400)
	})

	it('returns 400 when required fields are missing', async () => {
		const { POST } = await import('./+server')
		const resp = await POST(makeEvent({ connectionId: 'c1' }) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 404 when connection is not found', async () => {
		setupDbMocks({ connection: null })
		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(404)
	})

	it('returns 404 when project is not found', async () => {
		setupDbMocks({ connection: { id: 'c1', accessToken: 'enc:tok' }, project: null })
		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(404)
	})

	it('returns 400 when project has no webhook secret', async () => {
		setupDbMocks({
			connection: { id: 'c1', accessToken: 'enc:tok' },
			project: { id: 'p1', webhookSecret: null }
		})
		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(400)
	})

	it('creates webhook and returns webhookId', async () => {
		setupDbMocks({
			connection: { id: 'c1', accessToken: 'enc:tok' },
			project: { id: 'p1', webhookSecret: 'whsec_abc' }
		})
		mockCreateWebhook.mockResolvedValue({ id: 99 })

		const { POST } = await import('./+server')
		const resp = await POST(
			makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never
		)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ success: true, webhookId: 99 })
		expect(mockCreateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 42, secret: 'whsec_abc' })
		)
	})

	it('uses hostname setting for webhook URL when available', async () => {
		setupDbMocks({
			connection: { id: 'c1', accessToken: 'enc:tok' },
			project: { id: 'p1', webhookSecret: 'whsec_abc' }
		})
		mockGetSetting.mockResolvedValue('myhost.example.com')
		mockCreateWebhook.mockResolvedValue({ id: 100 })

		const { POST } = await import('./+server')
		await POST(makeEvent({ connectionId: 'c1', projectId: 'p1', gitlabProjectId: 42 }) as never)
		expect(mockCreateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ webhookUrl: expect.stringContaining('myhost.example.com') })
		)
	})
})
