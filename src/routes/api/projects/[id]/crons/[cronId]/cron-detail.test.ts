import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const cronJobRows: Record<string, unknown>[] = []
const cronRunRows: Record<string, unknown>[] = []

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.orderBy = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockDb = {
	select: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' },
	cronJobs: { id: 'id', projectId: 'project_id', enabled: 'enabled' },
	cronRuns: { id: 'id', cronJobId: 'cron_job_id', startedAt: 'started_at' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue({
		register: vi.fn(),
		unregister: vi.fn()
	})
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), desc: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(overrides: {
	method?: string
	body?: unknown
	params?: Record<string, string>
} = {}) {
	const { method = 'GET', body, params = { id: 'proj-1', cronId: 'cron-1' } } = overrides
	return {
		request: new Request('http://localhost/', {
			method,
			...(body
				? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
				: {})
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params,
		url: new URL('http://localhost/')
	}
}

function setupSelectSequence(...rowSets: unknown[][]) {
	let call = 0
	mockDb.select.mockImplementation(() => {
		const rows = rowSets[call] ?? []
		call++
		return makeSelectChain(rows)
	})
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		cronJobRows.length = 0
		cronRunRows.length = 0
	})

	it('returns 404 when cron job not found', async () => {
		setupSelectSequence([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(404)
	})

	it('returns 200 with job and runs', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1', name: 'Daily', schedule: '0 3 * * *' }
		const runs = [{ id: 'run-1', cronJobId: 'cron-1', status: 'success' }]
		setupSelectSequence([job], runs)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.id).toBe('cron-1')
		expect(data.runs).toBeDefined()
	})
})

describe('PUT /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when cron not found', async () => {
		setupSelectSequence([])

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ method: 'PUT', body: { name: 'New' } }) as never)
		expect(res.status).toBe(404)
	})

	it('returns 400 for invalid JSON body', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1', enabled: true }
		setupSelectSequence([job])

		const { PUT } = await import('./+server')
		const badReq = {
			request: { json: vi.fn().mockRejectedValue(new Error('bad json')) },
			locals: { user: { id: 'user-1' }, session: {} },
			params: { id: 'proj-1', cronId: 'cron-1' },
			url: new URL('http://localhost/')
		}
		const res = await PUT(badReq as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid cron schedule', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1', enabled: true }
		setupSelectSequence([job])

		const { PUT } = await import('./+server')
		const res = await PUT(
			makeEvent({ method: 'PUT', body: { schedule: 'not-a-cron' } }) as never
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid method value', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1', enabled: true }
		setupSelectSequence([job])

		const { PUT } = await import('./+server')
		const res = await PUT(
			makeEvent({ method: 'PUT', body: { method: 'DELETE' } }) as never
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 for route without leading slash', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1', enabled: true }
		setupSelectSequence([job])

		const { PUT } = await import('./+server')
		const res = await PUT(
			makeEvent({ method: 'PUT', body: { route: 'no-leading-slash' } }) as never
		)
		expect(res.status).toBe(400)
	})

	it('updates job and returns 200', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1', enabled: true, name: 'Old' }
		const updated = { ...job, name: 'New' }
		setupSelectSequence([job], [updated])

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		})

		const { PUT } = await import('./+server')
		const res = await PUT(makeEvent({ method: 'PUT', body: { name: 'New' } }) as never)
		expect(res.status).toBe(200)
	})
})

describe('DELETE /api/projects/:id/crons/:cronId', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when cron not found', async () => {
		setupSelectSequence([])

		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent({ method: 'DELETE' }) as never)
		expect(res.status).toBe(404)
	})

	it('deletes the job and returns success', async () => {
		const job = { id: 'cron-1', projectId: 'proj-1' }
		setupSelectSequence([job])

		mockDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})

		const { DELETE } = await import('./+server')
		const res = await DELETE(makeEvent({ method: 'DELETE' }) as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.success).toBe(true)
	})
})
