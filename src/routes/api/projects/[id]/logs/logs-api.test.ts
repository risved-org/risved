import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn() }
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((_col, val) => ({ op: 'eq', val }))
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({ exec: vi.fn() })),
	getContainerLogs: vi.fn()
}))

import { db } from '$lib/server/db'
import { getContainerLogs } from '$lib/server/pipeline/docker'
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
	const url = new URL(`http://localhost/api/projects/${id}/logs`)
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		params: { id },
		url,
		locals: {},
		request: new Request(url.toString())
	} as Parameters<typeof GET>[0]
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('GET /api/projects/:id/logs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 404 when project does not exist', async () => {
		setupSelectChain([])
		await expect(GET(makeEvent('p-missing'))).rejects.toMatchObject({ status: 404 })
	})

	it('returns container logs for existing project', async () => {
		const project = { id: 'p1', slug: 'my-app' }
		setupSelectChain([project])
		vi.mocked(getContainerLogs).mockResolvedValue('line1\nline2\n')

		const res = await GET(makeEvent('p1'))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ logs: 'line1\nline2\n' })
	})

	it('uses default tail of 200 when not specified', async () => {
		const project = { id: 'p1', slug: 'my-app' }
		setupSelectChain([project])
		vi.mocked(getContainerLogs).mockResolvedValue('')

		await GET(makeEvent('p1'))
		const [, , tail] = vi.mocked(getContainerLogs).mock.calls[0]
		expect(tail).toBe(200)
	})

	it('uses provided tail parameter', async () => {
		const project = { id: 'p1', slug: 'my-app' }
		setupSelectChain([project])
		vi.mocked(getContainerLogs).mockResolvedValue('')

		await GET(makeEvent('p1', { tail: '50' }))
		const [, , tail] = vi.mocked(getContainerLogs).mock.calls[0]
		expect(tail).toBe(50)
	})

	it('clamps tail to maximum of 1000', async () => {
		const project = { id: 'p1', slug: 'my-app' }
		setupSelectChain([project])
		vi.mocked(getContainerLogs).mockResolvedValue('')

		await GET(makeEvent('p1', { tail: '9999' }))
		const [, , tail] = vi.mocked(getContainerLogs).mock.calls[0]
		expect(tail).toBe(1000)
	})
})
