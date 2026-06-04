import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	const whereMock = vi.fn(() => ({ limit: limitMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	return {
		db: {
			select: selectMock,
			__limitMock: limitMock,
			__whereMock: whereMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table'
}))

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, message: string) => {
		throw Object.assign(new Error(message), { status })
	})
}))

import { db } from '$lib/server/db'
import { load } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeLoadEvent(slug = 'test-app') {
	return { params: { slug } } as unknown as Parameters<typeof load>[0]
}

beforeEach(() => {
	vi.clearAllMocks()
	dbAny.__limitMock.mockResolvedValue([])
})

describe('project logs load', () => {
	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([])

		await expect(load(makeLoadEvent())).rejects.toMatchObject({ status: 404 })
	})

	it('returns empty object when project exists', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1', slug: 'test-app' }])

		const result = await load(makeLoadEvent())
		expect(result).toEqual({})
	})
})
