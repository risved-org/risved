import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mock DB ────────────────────────────────────────────────────────── */

const mockDb = { select: vi.fn() }

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	}
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id' }
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

const mockScheduler = {
	execute: vi.fn().mockResolvedValue({ status: 'success', statusCode: 200 })
}

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue(mockScheduler)
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))

/* ── Helpers ─────────────────────────────────────────────────────────── */

const mockJob = { id: 'cron-1', projectId: 'proj-1' }

function makeEvent() {
	return {
		request: new Request('http://localhost/', { method: 'POST' }),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', cronId: 'cron-1' },
		url: new URL('http://localhost/')
	}
}

/* ── Tests ───────────────────────────────────────────────────────────── */

describe('POST /api/projects/:id/crons/:cronId/trigger', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 200 with triggered result', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.triggered).toBe(true)
		expect(data.result.status).toBe('success')
	})

	it('returns 404 when cron job not found', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([]))

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)

		expect(res.status).toBe(404)
	})

	it('returns 400 when no live deployment to execute against', async () => {
		mockDb.select.mockReturnValueOnce(makeSelectChain([mockJob]))
		mockScheduler.execute.mockResolvedValueOnce(null)

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as never)

		expect(res.status).toBe(400)
	})
})
