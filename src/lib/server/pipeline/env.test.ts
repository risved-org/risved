import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		select: vi.fn(),
		update: vi.fn()
	}
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', postgresPassword: 'postgresPassword' },
	envVars: { key: 'key', value: 'value', projectId: 'projectId' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((col: unknown, val: unknown) => ({ col, val }))
}))
vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `encrypted:${v}`),
	safeDecrypt: vi.fn((v: string) => v.replace(/^encrypted:/, ''))
}))

import { loadProjectEnv, resolveManagedPostgresEnv } from './env'

describe('loadProjectEnv', () => {
	beforeEach(() => vi.clearAllMocks())

	it('decrypts and maps stored env vars by key', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([
					{ key: 'API_KEY', value: 'encrypted:secret1' },
					{ key: 'PORT', value: 'encrypted:3000' }
				])
			})
		})

		const env = await loadProjectEnv('proj-1')

		expect(env).toEqual({ API_KEY: 'secret1', PORT: '3000' })
	})

	it('returns an empty object when the project has no env vars', async () => {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		})

		expect(await loadProjectEnv('proj-1')).toEqual({})
	})
})

describe('resolveManagedPostgresEnv', () => {
	beforeEach(() => vi.clearAllMocks())

	it('reuses and decrypts an existing stored password', async () => {
		const result = await resolveManagedPostgresEnv('proj-1', 'encrypted:existing-pw')

		expect(result.password).toBe('existing-pw')
		expect(mockDb.update).not.toHaveBeenCalled()
		expect(result.env.DATABASE_URL).toContain('existing-pw')
	})

	it('generates and stores a new password when none exists', async () => {
		const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		mockDb.update.mockReturnValue({ set: setMock })

		const result = await resolveManagedPostgresEnv('proj-1', null)

		expect(typeof result.password).toBe('string')
		expect(result.password.length).toBeGreaterThan(0)
		expect(mockDb.update).toHaveBeenCalled()
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({ postgresPassword: `encrypted:${result.password}` })
		)
	})

	it('generates a new password when no password was stored yet', async () => {
		const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		mockDb.update.mockReturnValue({ set: setMock })

		const result = await resolveManagedPostgresEnv('proj-1', undefined)

		expect(result.password).toBeTruthy()
		expect(mockDb.update).toHaveBeenCalled()
	})
})
