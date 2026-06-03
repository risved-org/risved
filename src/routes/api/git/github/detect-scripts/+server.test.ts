import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockListRootFiles, mockGetFileContents, mockSafeDecrypt, mockDetectScripts } =
	vi.hoisted(() => ({
		mockDb: { select: vi.fn() },
		mockListRootFiles: vi.fn(),
		mockGetFileContents: vi.fn(),
		mockSafeDecrypt: vi.fn((v: string) => `dec:${v}`),
		mockDetectScripts: vi.fn()
	}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({ gitConnections: { id: 'id' } }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/github', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitHubClient: vi.fn().mockImplementation(function (this: any) {
		this.listRootFiles = mockListRootFiles
		this.getFileContents = mockGetFileContents
	})
}))
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: mockSafeDecrypt }))
vi.mock('$lib/scripts-detect', () => ({ detectScripts: mockDetectScripts }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown) => new Response(JSON.stringify(body), { status: 200 }))
}))

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

const FULL_PARAMS = { connectionId: 'conn-1', owner: 'alice', repo: 'myrepo', branch: 'main' }

beforeEach(() => vi.clearAllMocks())

describe('GET /api/git/github/detect-scripts', () => {
	it('returns 400 when required params are missing', async () => {
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent({ connectionId: 'conn-1' }) as never)
		expect(resp.status).toBe(400)
	})

	it('returns 404 when connection not found', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([]))
		const { GET } = await import('./+server')
		const resp = await GET(makeEvent(FULL_PARAMS) as never)
		expect(resp.status).toBe(404)
	})

	it('returns detection result with lockfiles detected', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockListRootFiles.mockResolvedValue([
			{ type: 'file', name: 'bun.lock' },
			{ type: 'file', name: 'package.json' },
			{ type: 'dir', name: 'src' }
		])
		mockGetFileContents.mockResolvedValue('{"scripts":{"build":"bun build"}}')
		mockDetectScripts.mockReturnValue({ buildCommand: 'bun build', lockfile: 'bun.lock' })

		const { GET } = await import('./+server')
		const resp = await GET(makeEvent(FULL_PARAMS) as never)
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toMatchObject({ buildCommand: 'bun build' })
		expect(mockDetectScripts).toHaveBeenCalledWith(
			'{"scripts":{"build":"bun build"}}',
			expect.arrayContaining([{ name: 'bun.lock' }])
		)
	})

	it('passes empty lockfiles array when none match', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([{ id: 'conn-1', accessToken: 'enc' }]))
		mockListRootFiles.mockResolvedValue([{ type: 'file', name: 'README.md' }])
		mockGetFileContents.mockResolvedValue('{}')
		mockDetectScripts.mockReturnValue({})

		const { GET } = await import('./+server')
		await GET(makeEvent(FULL_PARAMS) as never)

		expect(mockDetectScripts).toHaveBeenCalledWith('{}', [])
	})
})
