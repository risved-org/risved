import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockSearchProjects, mockListProjects, mockSafeDecrypt } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockSearchProjects: vi.fn(),
	mockListProjects: vi.fn(),
	mockSafeDecrypt: vi.fn((v: string) => v)
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({ gitConnections: { id: 'id' } }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('$lib/server/gitlab', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitLabClient: vi.fn().mockImplementation(function (this: any) {
		this.searchProjects = mockSearchProjects
		this.listProjects = mockListProjects
	})
}))
vi.mock('$env/dynamic/private', () => ({
	env: { GITLAB_INSTANCE_URL: 'https://gitlab.example.com' }
}))

const PROJECT = {
	id: 42,
	name: 'my-repo',
	path_with_namespace: 'group/my-repo',
	namespace: { full_path: 'group' },
	visibility: 'private',
	default_branch: 'main',
	web_url: 'https://gitlab.example.com/group/my-repo',
	http_url_to_repo: 'https://gitlab.example.com/group/my-repo.git',
	description: 'A test repo',
	last_activity_at: '2024-01-01T00:00:00Z'
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

function makeEvent(params: { connectionId?: string; search?: string; page?: string } = {}) {
	const url = new URL('http://localhost/api/git/gitlab/repos')
	if (params.connectionId) url.searchParams.set('connectionId', params.connectionId)
	if (params.search) url.searchParams.set('search', params.search)
	if (params.page) url.searchParams.set('page', params.page)
	return {
		request: new Request(url.toString()),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url
	} as never
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/git/gitlab/repos', () => {
	it('returns 400 when connectionId is missing', async () => {
		const { GET } = await import('./+server')
		const res = await GET(makeEvent())
		expect(res.status).toBe(400)
	})

	it('returns 404 when connection not found', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([]))
		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ connectionId: 'nonexistent' }))
		expect(res.status).toBe(404)
	})

	it('returns mapped repo list via listProjects', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'token123' }]))
		mockListProjects.mockResolvedValue([PROJECT])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ connectionId: 'conn-1' }))

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toHaveLength(1)
		expect(data[0].fullName).toBe('group/my-repo')
		expect(data[0].defaultBranch).toBe('main')
		expect(data[0].private).toBe(true)
		expect(mockListProjects).toHaveBeenCalledWith(1)
	})

	it('calls searchProjects when search param is provided', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'token123' }]))
		mockSearchProjects.mockResolvedValue([{ ...PROJECT, name: 'found-repo' }])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ connectionId: 'conn-1', search: 'found' }))

		expect(res.status).toBe(200)
		expect(mockSearchProjects).toHaveBeenCalledWith('found')
		expect(mockListProjects).not.toHaveBeenCalled()
	})

	it('uses listProjects with page param', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'token123' }]))
		mockListProjects.mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({ connectionId: 'conn-1', page: '3' }))

		expect(mockListProjects).toHaveBeenCalledWith(3)
	})

	it('maps public repos with private=false', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'token123' }]))
		mockListProjects.mockResolvedValue([{ ...PROJECT, visibility: 'public' }])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent({ connectionId: 'conn-1' }))
		const data = await res.json()

		expect(data[0].private).toBe(false)
		expect(data[0].language).toBeNull()
	})

	it('ignores whitespace-only search and uses listProjects', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'token123' }]))
		mockListProjects.mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({ connectionId: 'conn-1', search: '   ' }))

		expect(mockListProjects).toHaveBeenCalled()
		expect(mockSearchProjects).not.toHaveBeenCalled()
	})
})
