import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockGet = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockSelect = vi.hoisted(() => vi.fn())

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@test.com' })
}))

vi.mock('$lib/server/health', () => ({
	getHealthMonitor: vi.fn(() => ({ getAll: mockGetAll, get: mockGet }))
}))

vi.mock('$lib/server/db', () => ({ db: { select: mockSelect } }))

vi.mock('$lib/server/db/schema', () => ({
	healthEvents: 'health_events_table'
}))

vi.mock('drizzle-orm', () => ({
	desc: vi.fn(() => 'desc_fn'),
	eq: vi.fn(() => 'eq_fn')
}))

import { GET, POST } from './+server'

function setupSelectChain(rows: unknown[]) {
	const limitMock = vi.fn().mockResolvedValue(rows)
	const orderByMock = vi.fn(() => ({ limit: limitMock }))
	const whereMock = vi.fn(() => ({ orderBy: orderByMock, limit: limitMock }))
	const fromMock = vi.fn(() => ({ orderBy: orderByMock, where: whereMock }))
	mockSelect.mockReturnValue({ from: fromMock })
	return { limitMock, orderByMock }
}

function makeGetEvent() {
	return {
		url: new URL('http://localhost/api/health'),
		locals: {},
		request: { headers: new Headers() }
	} as unknown as Parameters<typeof GET>[0]
}

describe('GET /api/health', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns statuses and events', async () => {
		const status = { projectId: 'p1', status: 'healthy' }
		mockGetAll.mockReturnValue([status])
		setupSelectChain([{ id: 'e1', event: 'healthy', projectId: 'p1' }])

		const res = await GET(makeGetEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.statuses).toEqual([status])
		expect(body.events).toHaveLength(1)
	})

	it('returns empty lists when nothing monitored', async () => {
		mockGetAll.mockReturnValue([])
		setupSelectChain([])

		const res = await GET(makeGetEvent())
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.statuses).toEqual([])
		expect(body.events).toEqual([])
	})
})

describe('POST /api/health', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when body is missing projectId', async () => {
		const event = {
			url: new URL('http://localhost/api/health'),
			locals: {},
			request: { json: vi.fn().mockResolvedValue({ other: 'field' }) }
		} as unknown as Parameters<typeof POST>[0]

		const res = await POST(event)
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.error).toContain('projectId')
	})

	it('returns 400 when request body is not parseable', async () => {
		const event = {
			url: new URL('http://localhost/api/health'),
			locals: {},
			request: { json: vi.fn().mockRejectedValue(new SyntaxError('invalid json')) }
		} as unknown as Parameters<typeof POST>[0]

		const res = await POST(event)
		expect(res.status).toBe(400)
	})

	it('returns null status when project not monitored', async () => {
		mockGet.mockReturnValue(undefined)
		setupSelectChain([])

		const event = {
			url: new URL('http://localhost/api/health'),
			locals: {},
			request: { json: vi.fn().mockResolvedValue({ projectId: 'proj-unknown' }) }
		} as unknown as Parameters<typeof POST>[0]

		const res = await POST(event)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toBeNull()
		expect(body.events).toEqual([])
	})

	it('returns status and events for monitored project', async () => {
		const health = { projectId: 'proj-1', status: 'healthy' }
		mockGet.mockReturnValue(health)
		setupSelectChain([{ id: 'e1', event: 'healthy', projectId: 'proj-1' }])

		const event = {
			url: new URL('http://localhost/api/health'),
			locals: {},
			request: { json: vi.fn().mockResolvedValue({ projectId: 'proj-1' }) }
		} as unknown as Parameters<typeof POST>[0]

		const res = await POST(event)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toEqual(health)
		expect(body.events).toHaveLength(1)
	})
})
