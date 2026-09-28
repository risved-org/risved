import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	update: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', postgresPassword: 'postgres_password', updatedAt: 'updated_at' },
	envVars: { key: 'key', value: 'value', projectId: 'project_id' }
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `encrypted:${v}`),
	safeDecrypt: vi.fn((v: string) => (v.startsWith('encrypted:') ? v.slice('encrypted:'.length) : v))
}))

import { loadProjectEnv, resolveManagedPostgresEnv } from './env'
import { encrypt } from '$lib/server/crypto'

describe('loadProjectEnv', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns a decrypted key/value map for the project', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([
					{ key: 'FOO', value: 'encrypted:bar' },
					{ key: 'BAZ', value: 'plain-value' }
				])
			})
		})

		const result = await loadProjectEnv('proj-1')

		expect(result).toEqual({ FOO: 'bar', BAZ: 'plain-value' })
	})

	it('returns an empty object when the project has no env vars', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		})

		const result = await loadProjectEnv('proj-1')

		expect(result).toEqual({})
	})
})

describe('resolveManagedPostgresEnv', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('reuses an existing stored password without writing to the db', async () => {
		const result = await resolveManagedPostgresEnv('proj-1', 'encrypted:existing-secret')

		expect(result.password).toBe('existing-secret')
		expect(result.postgres.containerName).toContain('proj-1')
		expect(result.env.DATABASE_URL).toContain('existing-secret')
		expect(mockDb.update).not.toHaveBeenCalled()
	})

	it('generates and stores a new password when none exists yet', async () => {
		const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		mockDb.update.mockReturnValue({ set: setMock })

		const result = await resolveManagedPostgresEnv('proj-1', null)

		expect(typeof result.password).toBe('string')
		expect(result.password.length).toBeGreaterThan(0)
		expect(encrypt).toHaveBeenCalledWith(result.password)
		expect(mockDb.update).toHaveBeenCalled()
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({ postgresPassword: `encrypted:${result.password}` })
		)
	})

	it('generates a new password when the stored value is undefined', async () => {
		const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		mockDb.update.mockReturnValue({ set: setMock })

		const result = await resolveManagedPostgresEnv('proj-1', undefined)

		expect(result.password.length).toBeGreaterThan(0)
		expect(mockDb.update).toHaveBeenCalled()
	})
})
