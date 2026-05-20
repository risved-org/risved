import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status })
	)
}))

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn() }
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((_col, val) => ({ op: 'eq', val }))
}))

vi.mock('$lib/server/metrics', () => ({
	getProjectMetrics: vi.fn()
}))

import { db } from '$lib/server/db'
import { getProjectMetrics } from '$lib/server/metrics'
import { GET } from './+server'

type MockDb = { select: ReturnType<typeof vi.fn> }
const mockDb = db as unknown as MockDb

/* ── Helpers ──────────────────────────────────────────────────────── */

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

function makeEvent(id: string, searchParams: Record<string, string> = {}) {
	const url = new URL(`http://localhost/api/projects/${id}/metrics`)
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		params: { id },
		url,
		locals: {},
		request: new Request(url.toString())
	} as Parameters<typeof GET>[0]
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/metrics', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when project does not exist', async () => {
		setupSelectChain([])
		const res = await GET(makeEvent('p-missing'))
		expect(res.status).toBe(404)
	})

	it('returns metrics for existing project', async () => {
		setupSelectChain([{ id: 'p1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([{ cpu: 10 }])

		const res = await GET(makeEvent('p1'))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ metrics: [{ cpu: 10 }] })
	})

	it('uses default hours of 24', async () => {
		setupSelectChain([{ id: 'p1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		await GET(makeEvent('p1'))
		expect(getProjectMetrics).toHaveBeenCalledWith('p1', 24)
	})

	it('passes custom hours parameter', async () => {
		setupSelectChain([{ id: 'p1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		await GET(makeEvent('p1', { hours: '48' }))
		expect(getProjectMetrics).toHaveBeenCalledWith('p1', 48)
	})

	it('clamps hours to maximum of 168', async () => {
		setupSelectChain([{ id: 'p1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		await GET(makeEvent('p1', { hours: '9999' }))
		expect(getProjectMetrics).toHaveBeenCalledWith('p1', 168)
	})

	it('falls back to 24 for non-numeric hours', async () => {
		setupSelectChain([{ id: 'p1' }])
		vi.mocked(getProjectMetrics).mockResolvedValue([])

		await GET(makeEvent('p1', { hours: 'bad' }))
		expect(getProjectMetrics).toHaveBeenCalledWith('p1', 24)
	})
})
