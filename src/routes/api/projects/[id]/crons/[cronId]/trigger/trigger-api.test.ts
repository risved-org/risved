import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ─────────────────────────────────────────────────────── */

const mockScheduler = {
	execute: vi.fn()
}

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	cronJobs: { id: 'id', projectId: 'project_id' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))
vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))
vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn()
}))

import { getCronScheduler } from '$lib/server/cron'

function makeEvent(params: Record<string, string> = {}) {
	return {
		locals: {},
		params: { id: 'proj-1', cronId: 'cron-1', ...params },
		request: new Request('http://localhost/api/projects/proj-1/crons/cron-1/trigger', { method: 'POST' })
	}
}

describe('POST /api/projects/:id/crons/:cronId/trigger', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCronScheduler).mockReturnValue(mockScheduler as ReturnType<typeof getCronScheduler>)
	})

	it('triggers the cron job and returns result', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'cron-1', projectId: 'proj-1' }])
				})
			})
		})
		mockScheduler.execute.mockResolvedValue({ status: 'success', statusCode: 200 })

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as Parameters<typeof POST>[0])

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.triggered).toBe(true)
		expect(body.result).toEqual({ status: 'success', statusCode: 200 })
	})

	it('returns 404 for unknown cron job', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		})

		const { POST } = await import('./+server')
		const res = await POST(makeEvent({ cronId: 'nope' }) as Parameters<typeof POST>[0])

		expect(res.status).toBe(404)
	})

	it('returns 400 when no live deployment is available', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'cron-1', projectId: 'proj-1' }])
				})
			})
		})
		mockScheduler.execute.mockResolvedValue(null)

		const { POST } = await import('./+server')
		const res = await POST(makeEvent() as Parameters<typeof POST>[0])

		expect(res.status).toBe(400)
	})
})
