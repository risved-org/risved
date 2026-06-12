import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id', projectId: 'project_id', status: 'status' },
	buildLogs: { id: 'id', deploymentId: 'deployment_id', timestamp: 'timestamp' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	asc: vi.fn(() => 'asc_fn'),
	gt: vi.fn(() => 'gt_fn')
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})
	)
}))

import { GET } from './+server'

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(params: Record<string, string> = {}) {
	return {
		request: new Request('http://localhost/api/projects/p-1/deployments/d-1'),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'p-1', did: 'd-1', ...params },
		url: new URL('http://localhost/api/projects/p-1/deployments/d-1')
	} as never
}

function buildChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			}),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	}
}

async function collectSSE(response: Response): Promise<string> {
	const reader = response.body!.getReader()
	const decoder = new TextDecoder()
	const chunks: string[] = []
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		chunks.push(decoder.decode(value))
	}
	return chunks.join('')
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/deployments/:did/logs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when deployment not found', async () => {
		mockDb.select.mockReturnValueOnce(buildChain([]))
		const response = await GET(makeEvent())
		expect(response.status).toBe(404)
	})

	it('returns SSE content-type header for a terminal deployment', async () => {
		const deployment = { id: 'd-1', projectId: 'p-1', status: 'live' }
		mockDb.select.mockReturnValueOnce(buildChain([deployment]))
		mockDb.select.mockReturnValueOnce(buildChain([]))
		const response = await GET(makeEvent())
		expect(response.headers.get('Content-Type')).toBe('text/event-stream')
	})

	describe('terminal deployment', () => {
		it('streams all existing logs and sends done event', async () => {
			const deployment = { id: 'd-1', projectId: 'p-1', status: 'live' }
			const logs = [
				{ timestamp: '2024-01-01T00:00:00Z', phase: 'build', level: 'info', message: 'Started' },
				{ timestamp: '2024-01-01T00:00:01Z', phase: 'build', level: 'info', message: 'Done' }
			]
			mockDb.select.mockReturnValueOnce(buildChain([deployment]))
			mockDb.select.mockReturnValueOnce(buildChain(logs))

			const response = await GET(makeEvent())
			const body = await collectSSE(response)

			expect(body).toContain('"message":"Started"')
			expect(body).toContain('"message":"Done"')
			expect(body).toContain('event: done')
			expect(body).toContain('data: live')
		})

		it('sends done event with failed status', async () => {
			const deployment = { id: 'd-1', projectId: 'p-1', status: 'failed' }
			mockDb.select.mockReturnValueOnce(buildChain([deployment]))
			mockDb.select.mockReturnValueOnce(buildChain([]))

			const response = await GET(makeEvent())
			const body = await collectSSE(response)
			expect(body).toContain('data: failed')
		})

		it('sends done event with stopped status', async () => {
			const deployment = { id: 'd-1', projectId: 'p-1', status: 'stopped' }
			mockDb.select.mockReturnValueOnce(buildChain([deployment]))
			mockDb.select.mockReturnValueOnce(buildChain([]))

			const response = await GET(makeEvent())
			const body = await collectSSE(response)
			expect(body).toContain('data: stopped')
		})
	})

	describe('in-progress deployment', () => {
		it('streams logs and closes when deployment becomes terminal', async () => {
			const inProgress = { id: 'd-1', projectId: 'p-1', status: 'running' }
			const newLogs = [
				{ id: 1, timestamp: '2024-01-01T00:00:00Z', phase: 'clone', level: 'info', message: 'Cloning' }
			]
			const terminal = { id: 'd-1', status: 'live' }

			mockDb.select.mockReturnValueOnce(buildChain([inProgress]))  // initial lookup
			mockDb.select.mockReturnValueOnce(buildChain(newLogs))        // build logs in stream
			mockDb.select.mockReturnValueOnce(buildChain([terminal]))     // re-check → terminal

			const response = await GET(makeEvent())
			expect(response.headers.get('Content-Type')).toBe('text/event-stream')

			const body = await collectSSE(response)
			expect(body).toContain('"message":"Cloning"')
			expect(body).toContain('event: done')
			expect(body).toContain('data: live')
		})

		it('closes with unknown status when deployment disappears mid-stream', async () => {
			const inProgress = { id: 'd-1', projectId: 'p-1', status: 'building' }

			mockDb.select.mockReturnValueOnce(buildChain([inProgress]))
			mockDb.select.mockReturnValueOnce(buildChain([]))  // no new logs
			mockDb.select.mockReturnValueOnce(buildChain([]))  // deployment gone

			const response = await GET(makeEvent())
			const body = await collectSSE(response)
			expect(body).toContain('data: unknown')
		})

		it('handles stream cancellation gracefully', async () => {
			const inProgress = { id: 'd-1', projectId: 'p-1', status: 'running' }

			mockDb.select.mockReturnValueOnce(buildChain([inProgress]))
			mockDb.select.mockReturnValueOnce(buildChain([]))
			mockDb.select.mockReturnValueOnce(buildChain([{ id: 'd-1', status: 'live' }]))

			const response = await GET(makeEvent())
			expect(response.headers.get('Content-Type')).toBe('text/event-stream')
			const reader = response.body!.getReader()
			await reader.cancel()
		})
	})
})
