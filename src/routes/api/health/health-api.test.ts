import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ─────────────────────────────────────────────────────── */

const mockMonitor = {
	getAll: vi.fn(),
	get: vi.fn()
}

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			orderBy: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue(rows)
					})
				})
			}),
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(rows)
				})
			})
		})
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	healthEvents: { createdAt: 'created_at', projectId: 'project_id' }
}))
vi.mock('drizzle-orm', () => ({ desc: vi.fn(), eq: vi.fn() }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' })
}))
vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn()
}))

import { getHealthMonitor } from '$lib/server/health'

function makeEvent(overrides: { method?: string; body?: unknown } = {}) {
	const { method = 'GET', body } = overrides
	return {
		locals: {},
		request: new Request('http://localhost/api/health', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		})
	}
}

describe('GET /api/health', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getHealthMonitor).mockReturnValue(
			mockMonitor as ReturnType<typeof getHealthMonitor>
		)
	})

	it('returns statuses and recent events', async () => {
		const statuses = { 'proj-1': { healthy: true } }
		const events = [{ id: 'e1', projectId: 'proj-1', healthy: true }]
		mockMonitor.getAll.mockReturnValue(statuses)
		setupSelectChain(events)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as Parameters<typeof GET>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.statuses).toEqual(statuses)
		expect(body.events).toEqual(events)
	})

	it('returns empty statuses and events when nothing is monitored', async () => {
		mockMonitor.getAll.mockReturnValue({})
		setupSelectChain([])

		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as Parameters<typeof GET>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.statuses).toEqual({})
		expect(body.events).toHaveLength(0)
	})
})

describe('POST /api/health', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getHealthMonitor).mockReturnValue(
			mockMonitor as ReturnType<typeof getHealthMonitor>
		)
	})

	it('returns 400 when projectId is missing', async () => {
		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ method: 'POST', body: {} }) as Parameters<typeof POST>[0])
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.error).toContain('projectId')
	})

	it('returns health status and events for a project', async () => {
		const status = { healthy: true, lastChecked: '2024-01-01' }
		const events = [{ id: 'e1', projectId: 'p1', healthy: false }]
		mockMonitor.get.mockReturnValue(status)
		setupSelectChain(events)

		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({ method: 'POST', body: { projectId: 'p1' } }) as Parameters<typeof POST>[0]
		)

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toEqual(status)
		expect(body.events).toEqual(events)
	})

	it('returns null status for unknown project', async () => {
		mockMonitor.get.mockReturnValue(undefined)
		setupSelectChain([])

		const { POST } = await import('./+server')
		const res = await POST(
			makeEvent({ method: 'POST', body: { projectId: 'unknown' } }) as Parameters<typeof POST>[0]
		)

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toBeNull()
	})

	it('returns 400 when body is invalid JSON', async () => {
		const event = {
			locals: {},
			request: new Request('http://localhost/api/health', {
				method: 'POST',
				body: 'not-json'
			})
		}
		const { POST } = await import('./+server')
		const res = await POST(event as Parameters<typeof POST>[0])
		expect(res.status).toBe(400)
	})
})
