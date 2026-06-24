import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		all: vi.fn(),
		run: vi.fn()
	}
}))

vi.mock('./index', () => ({ db: mockDb }))
vi.mock('drizzle-orm', () => ({
	sql: { raw: (s: string) => s }
}))

import { reconcileSchema } from './reconcile'

/** Build a PRAGMA table_info result from a list of column names */
function cols(...names: string[]) {
	return names.map((name) => ({ name }))
}

describe('reconcileSchema', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockDb.run.mockResolvedValue(undefined)
	})

	it('adds all postgres_* columns when none exist (the broken-0005 case)', async () => {
		mockDb.all.mockResolvedValue(cols('id', 'name', 'release_command'))

		await reconcileSchema()

		const added = mockDb.run.mock.calls.map((c) => c[0])
		expect(added).toEqual([
			'ALTER TABLE projects ADD postgres_enabled integer DEFAULT false NOT NULL',
			'ALTER TABLE projects ADD postgres_password text',
			'ALTER TABLE projects ADD postgres_created_at text'
		])
	})

	it('is a no-op when every required column already exists', async () => {
		mockDb.all.mockResolvedValue(
			cols('id', 'postgres_enabled', 'postgres_password', 'postgres_created_at')
		)

		await reconcileSchema()

		expect(mockDb.run).not.toHaveBeenCalled()
	})

	it('adds only the columns that are missing', async () => {
		mockDb.all.mockResolvedValue(cols('id', 'postgres_enabled'))

		await reconcileSchema()

		const added = mockDb.run.mock.calls.map((c) => c[0])
		expect(added).toEqual([
			'ALTER TABLE projects ADD postgres_password text',
			'ALTER TABLE projects ADD postgres_created_at text'
		])
	})
})
