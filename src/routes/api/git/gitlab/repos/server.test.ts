import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockListProjects, mockSearchProjects, mockSafeDecrypt } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockListProjects: vi.fn(),
	mockSearchProjects: vi.fn(),
	mockSafeDecrypt: vi.fn((v: string) => `dec:${v}`)
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/gitlab', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitLabClient: vi.fn().mockImplementation(function (this: any) {
		this.listProjects = mockListProjects
		this.searchProjects = mockSearchProjects
	})
}))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
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

const PROJECT = {
	id: 1,
	path_with_namespace: 'alice/my-project',
	name: 'my-project',
	namespace: { full_path: 'alice' },
	visibility: 'private',
	default_branch: 'main',
	web_url: 'https://gitlab.com/alice/my-project',
	http_url_to_repo: 'https://gitlab.com/alice/my-project.git',
	description: 'A project',
	last_activity_at: '2024-01-01'
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

beforeEach(() => vi.clearAllMocks())

describe('GET /api/git/gitlab/repos', () => {
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

	it('lists projects when no search query', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockListProjects.mockResolvedValue([PROJECT])

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data[0]).toMatchObject({ fullName: 'alice/my-project', private: true })
	})

	it('searches projects when search query is present', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockSearchProjects.mockResolvedValue([PROJECT])

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1', search: 'my-proj' }) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data[0]).toMatchObject({ fullName: 'alice/my-project' })
		expect(mockSearchProjects).toHaveBeenCalledWith('my-proj')
	})

	it('maps project fields correctly', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockListProjects.mockResolvedValue([PROJECT])

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1' }) as never)
		const data = await resp.json()
		const p = data[0]
		expect(p.id).toBe(1)
		expect(p.owner).toBe('alice')
		expect(p.defaultBranch).toBe('main')
		expect(p.cloneUrl).toBe('https://gitlab.com/alice/my-project.git')
		expect(p.language).toBeNull()
	})
})
