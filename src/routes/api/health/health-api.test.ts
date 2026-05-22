import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelectChain = {
	from: vi.fn(),
	where: vi.fn(),
	orderBy: vi.fn(),
	limit: vi.fn()
}

function setupSelect(rows: unknown[]) {
	mockSelectChain.limit.mockResolvedValue(rows)
	mockSelectChain.orderBy.mockReturnValue(mockSelectChain)
	mockSelectChain.where.mockReturnValue(mockSelectChain)
	mockSelectChain.from.mockReturnValue(mockSelectChain)
	mockDb.select.mockReturnValue(mockSelectChain)
}

const mockDb = {
	select: vi.fn()
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	healthEvents: { createdAt: 'created_at', projectId: 'project_id' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' })
}))

const mockMonitor = {
	getAll: vi.fn().mockReturnValue({ 'proj-1': { healthy: true } }),
	get: vi.fn().mockReturnValue({ healthy: true, lastChecked: '2024-01-01' })
}

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn().mockReturnValue(mockMonitor)
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	desc: vi.fn()
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		request: new Request('http://localhost/api/health', { method: 'GET' }),
		locals: { user: { id: 'user-1' }, session: {} },
		params: {},
		url: new URL('http://localhost/api/health'),
		...overrides
	}
}

describe('GET /api/health', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setupSelect([{ id: 'e-1', projectId: 'proj-1', status: 'healthy' }])
	})

	it('returns 200 with statuses and events', async () => {
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.statuses).toBeDefined()
		expect(data.events).toBeDefined()
	})

	it('returns empty events when none exist', async () => {
		setupSelect([])
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.events).toHaveLength(0)
	})
})

describe('POST /api/health', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setupSelect([{ id: 'e-1', projectId: 'proj-1', status: 'healthy' }])
	})

	it('returns status and events for a known project', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				request: new Request('http://localhost/api/health', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ projectId: 'proj-1' })
				})
			}) as never
		)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.status).toBeDefined()
		expect(data.events).toBeDefined()
	})

	it('returns 400 when projectId is missing', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				request: new Request('http://localhost/api/health', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ other: 'field' })
				})
			}) as never
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 for invalid JSON body', async () => {
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				request: new Request('http://localhost/api/health', {
					method: 'POST',
					body: 'not-json'
				})
			}) as never
		)
		expect(res.status).toBe(400)
	})

	it('returns null status for unknown project', async () => {
		mockMonitor.get.mockReturnValueOnce(undefined)
		setupSelect([])
		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({
				request: new Request('http://localhost/api/health', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ projectId: 'unknown-proj' })
				})
			}) as never
		)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.status).toBeNull()
	})
})
