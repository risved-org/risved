import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
	select: vi.fn()
}

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn()
}))

const mockGetContainerLogs = vi.fn().mockResolvedValue('line1\nline2\nline3')

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	getContainerLogs: mockGetContainerLogs
}))

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		params: { id: 'proj-1' },
		url: new URL('http://localhost/api/projects/proj-1/logs'),
		...overrides
	}
}

describe('GET /api/projects/:id/logs', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns logs for an existing project', async () => {
		setupSelect([{ id: 'proj-1', slug: 'my-app', port: 3000 }])
		const { GET } = await import('./+server')
		const res = await GET(makeEvent() as never)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.logs).toBe('line1\nline2\nline3')
	})

	it('throws 404 for unknown project', async () => {
		setupSelect([])
		const { GET } = await import('./+server')
		await expect(GET(makeEvent() as never)).rejects.toMatchObject({ status: 404 })
	})

	it('clamps tail to 1000', async () => {
		setupSelect([{ id: 'proj-1', slug: 'my-app', port: 3000 }])
		const { GET } = await import('./+server')
		await GET(
			makeEvent({
				url: new URL('http://localhost/api/projects/proj-1/logs?tail=9999')
			}) as never
		)
		expect(mockGetContainerLogs).toHaveBeenCalledWith(expect.anything(), 'my-app', 1000)
	})

	it('uses default tail of 200 when not specified', async () => {
		setupSelect([{ id: 'proj-1', slug: 'my-app', port: 3000 }])
		const { GET } = await import('./+server')
		await GET(makeEvent() as never)
		expect(mockGetContainerLogs).toHaveBeenCalledWith(expect.anything(), 'my-app', 200)
	})
})
