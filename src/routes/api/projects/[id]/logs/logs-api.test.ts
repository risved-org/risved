import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockGetContainerLogs = vi.fn()
const mockCreateCommandRunner = vi.fn().mockReturnValue({ exec: vi.fn() })

const mockDb = { select: vi.fn() }

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' }
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: mockCreateCommandRunner,
	getContainerLogs: mockGetContainerLogs
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(searchParams = '') {
	return {
		request: new Request('http://localhost/'),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1' },
		url: new URL(`http://localhost/?${searchParams}`)
	}
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue(makeSelectChain(rows))
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/logs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when project not found', async () => {
		setupSelect([])

		const { GET } = await import('./+server')
		try {
			await GET(makeEvent() as never)
			expect.fail('expected error() to throw')
		} catch (e: unknown) {
			const err = e as { status?: number }
			expect(err.status).toBe(404)
		}
	})

	it('returns container logs with default tail=200', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		setupSelect([project])
		mockGetContainerLogs.mockResolvedValue('line1\nline2\n')

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.logs).toBe('line1\nline2\n')
	})

	it('respects custom tail param (capped at 1000)', async () => {
		const project = { id: 'proj-1', slug: 'my-app' }
		setupSelect([project])
		mockGetContainerLogs.mockResolvedValue('logs')

		const { GET } = await import('./+server')
		await GET(makeEvent('tail=9999') as never)
		expect(mockGetContainerLogs).toHaveBeenCalledWith(expect.anything(), 'my-app', 1000)
	})
})
