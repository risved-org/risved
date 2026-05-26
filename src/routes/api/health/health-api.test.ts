import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ──────────────────────────────────────────────────────────── */

function makeSelectChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockReturnValue(chain)
	chain.where = vi.fn().mockReturnValue(chain)
	chain.orderBy = vi.fn().mockReturnValue(chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockMonitor = {
	getAll: vi.fn().mockReturnValue({}),
	get: vi.fn()
}

const mockDb = { select: vi.fn() }

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	healthEvents: { createdAt: 'created_at', projectId: 'project_id' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' })
}))

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn(() => mockMonitor)
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), desc: vi.fn() }))

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeGetEvent() {
	return {
		request: new Request('http://localhost/'),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/')
	}
}

function makePostEvent(body: unknown) {
	return {
		request: new Request('http://localhost/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/')
	}
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue(makeSelectChain(rows))
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe('GET /api/health', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns statuses and recent events', async () => {
		const statuses = { 'proj-1': { healthy: true } }
		const events = [{ id: 'evt-1', projectId: 'proj-1', state: 'healthy' }]
		mockMonitor.getAll.mockReturnValue(statuses)
		setupSelect(events)

		const { GET } = await import('./+server')
		const res = await GET(makeGetEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.statuses).toEqual(statuses)
		expect(data.events).toBeDefined()
	})

	it('returns empty statuses when no containers monitored', async () => {
		mockMonitor.getAll.mockReturnValue({})
		setupSelect([])

		const { GET } = await import('./+server')
		const res = await GET(makeGetEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.statuses).toEqual({})
	})
})

describe('POST /api/health (project-specific)', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when projectId is missing from body', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makePostEvent({ other: 'field' }) as never)
		expect(res.status).toBe(400)
	})

	it('returns 400 when body is not valid JSON', async () => {
		const badReq = {
			request: { json: vi.fn().mockRejectedValue(new Error('bad json')) },
			locals: { user: { id: 'user-1' }, session: {} },
			params: {},
			url: new URL('http://localhost/')
		}
		const { POST } = await import('./+server')
		const res = await POST(badReq as never)
		expect(res.status).toBe(400)
	})

	it('returns health status and events for known project', async () => {
		const status = { healthy: true }
		const events = [{ id: 'e-1', projectId: 'proj-1' }]
		mockMonitor.get.mockReturnValue(status)
		setupSelect(events)

		const { POST } = await import('./+server')
		const res = await POST(makePostEvent({ projectId: 'proj-1' }) as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.status).toEqual(status)
		expect(data.events).toBeDefined()
	})

	it('returns null status for unknown project', async () => {
		mockMonitor.get.mockReturnValue(undefined)
		setupSelect([])

		const { POST } = await import('./+server')
		const res = await POST(makePostEvent({ projectId: 'unknown-id' }) as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.status).toBeNull()
	})
})
