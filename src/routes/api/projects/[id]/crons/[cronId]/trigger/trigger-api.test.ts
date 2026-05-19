import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Mock DB */
const mockRows: Record<string, unknown[]> = {
	cronJobs: []
}

function makeChain(tableName: string) {
	const rows = mockRows[tableName] ?? []
	const chain: Record<string, unknown> = {}
	chain.from = vi.fn().mockImplementation(() => chain)
	chain.where = vi.fn().mockImplementation(() => chain)
	chain.orderBy = vi.fn().mockImplementation(() => chain)
	chain.limit = vi.fn().mockImplementation((n: number) => Promise.resolve(rows.slice(0, n)))
	return chain
}

const mockDb = {
	select: vi.fn().mockImplementation(() => {
		const chain: Record<string, unknown> = {}
		chain.from = vi.fn().mockImplementation((table: unknown) => {
			if (table === (schema.cronJobs as unknown)) return makeChain('cronJobs')
			return makeChain('cronJobs')
		})
		return chain
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

import * as schema from '$lib/server/db/schema'
vi.mock('$lib/server/db/schema', async () => {
	const actual: Record<string, unknown> = {
		cronJobs: { id: 'id', projectId: 'project_id' }
	}
	return actual
})

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn()
}))

const mockExecute = vi.fn().mockResolvedValue({ status: 'success', statusCode: 200 })

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue({
		register: vi.fn(),
		unregister: vi.fn(),
		execute: mockExecute
	})
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1/trigger', {
			method: 'POST'
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', cronId: 'cron-1', ...(overrides.params as Record<string, string> ?? {}) },
		url: new URL('http://localhost/api/projects/proj-1/crons/cron-1/trigger'),
		...overrides
	}
}

describe('POST /api/projects/:id/crons/:cronId/trigger', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRows.cronJobs = []
		mockExecute.mockResolvedValue({ status: 'success', statusCode: 200 })
	})

	it('returns 404 when job not found', async () => {
		mockRows.cronJobs = []
		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(404)
		const data = await res.json()
		expect(data.error).toMatch(/cron job not found/i)
	})

	it('returns 400 when execute returns null', async () => {
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1' }]
		mockExecute.mockResolvedValue(null)
		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toMatch(/no live deployment/i)
	})

	it('returns 200 with triggered and result', async () => {
		mockRows.cronJobs = [{ id: 'cron-1', projectId: 'proj-1' }]
		mockExecute.mockResolvedValue({ status: 'success', statusCode: 200 })
		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.triggered).toBe(true)
		expect(data.result).toBeDefined()
		expect(data.result.statusCode).toBe(200)
	})
})
