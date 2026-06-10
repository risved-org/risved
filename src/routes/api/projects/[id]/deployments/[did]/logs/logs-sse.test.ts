import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const orderByMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const andWhereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: andWhereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))

	return {
		db: {
			select: selectMock,
			__limitMock: limitMock,
			__whereMock: whereMock,
			__andWhereMock: andWhereMock,
			__orderByMock: orderByMock,
			__fromMock: fromMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq'),
	and: vi.fn(() => 'and'),
	asc: vi.fn(() => 'asc'),
	gt: vi.fn(() => 'gt')
}))

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id', projectId: 'project_id', status: 'status' },
	buildLogs: { id: 'id', deploymentId: 'deployment_id', timestamp: 'ts' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

import { db } from '$lib/server/db'
import { GET } from './+server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeEvent(params: Record<string, string> = {}) {
	return {
		request: new Request('http://localhost/api/projects/p1/deployments/d1/logs'),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'p1', did: 'd1', ...params },
		url: new URL('http://localhost/api/projects/p1/deployments/d1/logs')
	} as never
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/deployments/:did/logs', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
		dbAny.__orderByMock.mockResolvedValue([])
		dbAny.__andWhereMock.mockImplementation(() => ({
			limit: dbAny.__limitMock,
			orderBy: dbAny.__orderByMock
		}))
	})

	it('returns 404 when deployment not found', async () => {
		/* deployment lookup returns empty */
		dbAny.__limitMock.mockResolvedValueOnce([])

		const res = await GET(makeEvent())
		expect(res.status).toBe(404)
	})

	it('returns SSE stream for a terminal deployment', async () => {
		const deployment = { id: 'd1', projectId: 'p1', status: 'live' }
		/* deployment lookup */
		dbAny.__limitMock.mockResolvedValueOnce([deployment])
		/* buildLogs query: select().from().where().orderBy() */
		const logs = [
			{ id: 1, timestamp: '2026-01-01T00:00:00Z', phase: 'build', level: 'info', message: 'Starting' },
			{ id: 2, timestamp: '2026-01-01T00:00:01Z', phase: 'build', level: 'info', message: 'Done' }
		]
		dbAny.__orderByMock.mockResolvedValueOnce(logs)

		const res = await GET(makeEvent())

		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('text/event-stream')

		/* consume the SSE stream */
		const reader = res.body!.getReader()
		const decoder = new TextDecoder()
		let fullText = ''
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			fullText += decoder.decode(value)
		}

		expect(fullText).toContain('"message":"Starting"')
		expect(fullText).toContain('"message":"Done"')
		expect(fullText).toContain('event: done')
		expect(fullText).toContain('live')
	})

	it('returns SSE stream with correct headers for terminal failed deployment', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'd1', projectId: 'p1', status: 'failed' }])
		dbAny.__orderByMock.mockResolvedValueOnce([])

		const res = await GET(makeEvent())

		expect(res.headers.get('Cache-Control')).toBe('no-cache')
		expect(res.headers.get('Connection')).toBe('keep-alive')

		/* drain the stream */
		const reader = res.body!.getReader()
		while (true) {
			const { done } = await reader.read()
			if (done) break
		}
	})

	it('returns SSE stream for in-progress deployment that immediately finishes', async () => {
		const building = { id: 'd1', projectId: 'p1', status: 'building' }
		/* first deployment lookup: in-progress */
		dbAny.__limitMock.mockResolvedValueOnce([building])
		/* inside stream: new logs query returns empty */
		dbAny.__andWhereMock.mockReturnValueOnce({ limit: dbAny.__limitMock, orderBy: dbAny.__orderByMock })
		dbAny.__orderByMock.mockResolvedValueOnce([]) /* no new logs */
		/* inside stream: status check returns terminal */
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'd1', status: 'live' }])

		const res = await GET(makeEvent())

		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('text/event-stream')

		/* drain stream */
		const reader = res.body!.getReader()
		const decoder = new TextDecoder()
		let fullText = ''
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) fullText += decoder.decode(value)
		}

		expect(fullText).toContain('event: done')
	})
})
