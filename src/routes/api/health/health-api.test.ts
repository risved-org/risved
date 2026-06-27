import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.hoisted(() => ({ select: vi.fn() }))
const mockMonitor = vi.hoisted(() => ({
	getAll: vi.fn(),
	get: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	healthEvents: { createdAt: 'created_at', projectId: 'project_id' }
}))
vi.mock('drizzle-orm', () => ({
	desc: vi.fn((col: unknown) => ({ desc: col })),
	eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
}))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' })
}))
vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn(() => mockMonitor)
}))

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			orderBy: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			}),
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(rows)
				})
			})
		})
	})
}

function makeEvent(overrides: { body?: unknown } = {}) {
	return {
		locals: { user: { id: 'user-1' } },
		request: {
			headers: { get: () => null },
			json: vi.fn().mockResolvedValue(overrides.body ?? null)
		},
		url: new URL('http://localhost/api/health')
	} as Record<string, unknown>
}

describe('GET /api/health', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns statuses and events', async () => {
		const statuses = [{ projectId: 'p-1', status: 'healthy' }]
		const events = [{ id: 'e-1', projectId: 'p-1' }]
		mockMonitor.getAll.mockReturnValue(statuses)
		setupSelectChain(events)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.statuses).toEqual(statuses)
		expect(data.events).toEqual(events)
	})
})

describe('POST /api/health', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when projectId missing', async () => {
		const { POST } = await import('./+server')
		const event = {
			...makeEvent(),
			request: { headers: { get: () => null }, json: vi.fn().mockResolvedValue({}) }
		} as never
		const res = await POST(event)
		expect(res.status).toBe(400)
	})

	it('returns 400 when body is null', async () => {
		const { POST } = await import('./+server')
		const event = {
			...makeEvent(),
			request: { headers: { get: () => null }, json: vi.fn().mockRejectedValue(new Error('bad')) }
		} as never
		const res = await POST(event)
		expect(res.status).toBe(400)
	})

	it('returns status and events for valid projectId', async () => {
		const projectStatus = { projectId: 'p-1', status: 'healthy' }
		const events = [{ id: 'e-1' }]
		mockMonitor.get.mockReturnValue(projectStatus)
		setupSelectChain(events)

		const { POST } = await import('./+server')
		const event = {
			...makeEvent(),
			request: {
				headers: { get: () => null },
				json: vi.fn().mockResolvedValue({ projectId: 'p-1' })
			}
		} as never
		const res = await POST(event)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.status).toEqual(projectStatus)
		expect(data.events).toEqual(events)
	})

	it('returns null status for unknown projectId', async () => {
		mockMonitor.get.mockReturnValue(undefined)
		setupSelectChain([])

		const { POST } = await import('./+server')
		const event = {
			...makeEvent(),
			request: {
				headers: { get: () => null },
				json: vi.fn().mockResolvedValue({ projectId: 'unknown' })
			}
		} as never
		const res = await POST(event)

		const data = await res.json()
		expect(data.status).toBeNull()
	})
})
