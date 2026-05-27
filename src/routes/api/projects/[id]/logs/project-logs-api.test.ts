import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.hoisted(() => ({ select: vi.fn() }))
const mockRunner = vi.hoisted(() => ({ exec: vi.fn() }))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
}))
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => mockRunner),
	getContainerLogs: vi.fn()
}))

import { getContainerLogs } from '$lib/server/pipeline/docker'

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

function makeEvent(params: Record<string, string> = {}, searchParams: Record<string, string> = {}) {
	const url = new URL('http://localhost/api/projects/p-1/logs')
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
	return {
		params: { id: 'p-1', ...params },
		url
	} as never
}

describe('GET /api/projects/[id]/logs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns logs for a project', async () => {
		setupSelectChain([{ id: 'p-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue(['line 1', 'line 2'] as never)

		const { GET } = await import('./+server')
		const res = await GET(makeEvent())

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.logs).toEqual(['line 1', 'line 2'])
	})

	it('passes default tail of 200', async () => {
		setupSelectChain([{ id: 'p-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent())

		expect(getContainerLogs).toHaveBeenCalledWith(mockRunner, 'my-app', 200)
	})

	it('respects custom tail parameter', async () => {
		setupSelectChain([{ id: 'p-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({}, { tail: '50' }))

		expect(getContainerLogs).toHaveBeenCalledWith(mockRunner, 'my-app', 50)
	})

	it('caps tail at 1000', async () => {
		setupSelectChain([{ id: 'p-1', slug: 'my-app' }])
		vi.mocked(getContainerLogs).mockResolvedValue([])

		const { GET } = await import('./+server')
		await GET(makeEvent({}, { tail: '5000' }))

		expect(getContainerLogs).toHaveBeenCalledWith(mockRunner, 'my-app', 1000)
	})

	it('throws 404 when project not found', async () => {
		setupSelectChain([])

		const { GET } = await import('./+server')
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 404 })
	})
})
