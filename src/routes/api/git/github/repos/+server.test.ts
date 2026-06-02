import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockListRepos, mockSearchRepos, mockSafeDecrypt } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockListRepos: vi.fn(),
	mockSearchRepos: vi.fn(),
	mockSafeDecrypt: vi.fn((v: string) => `dec:${v}`)
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/github', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitHubClient: vi.fn().mockImplementation(function (this: any) {
		this.listRepos = mockListRepos
		this.searchRepos = mockSearchRepos
	})
}))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown) => new Response(JSON.stringify(body), { status: 200 }))
}))

const REPO = {
	id: 42,
	full_name: 'alice/repo',
	name: 'repo',
	owner: { login: 'alice' },
	private: false,
	default_branch: 'main',
	html_url: 'https://github.com/alice/repo',
	clone_url: 'https://github.com/alice/repo.git',
	description: 'A repo',
	language: 'TypeScript',
	updated_at: '2024-01-01'
}

function makeEvent(searchParams: Record<string, string>) {
	const url = new URL('http://localhost/')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		request: new Request(url.toString()),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url
	}
}

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	}
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/git/github/repos', () => {
	it('returns 400 when connectionId is missing', async () => {
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({}) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 404 when connection not found', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([]))
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(404)
	})

	it('lists repos when no search query', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockListRepos.mockResolvedValue([REPO])

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data[0]).toMatchObject({ fullName: 'alice/repo', language: 'TypeScript' })
	})

	it('searches repos when search query is present', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockSearchRepos.mockResolvedValue([REPO])

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1', search: 'repo' }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data[0]).toMatchObject({ fullName: 'alice/repo' })
	})
})
