import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return {
		db: {
			select: selectMock,
			__limitMock: limitMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table'
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

/* ── Tests ────────────────────────────────────────────────────────── */

describe('logs page load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbAny.__limitMock.mockResolvedValue([])
	})

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('returns empty object when project exists', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'my-app' }])

		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])

		expect(result).toEqual({})
	})
})
