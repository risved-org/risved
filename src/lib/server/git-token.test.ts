import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() }
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accessToken: 'access_token', provider: 'provider' }
}))
vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}))
vi.mock('$lib/server/crypto', () => ({
	safeDecrypt: vi.fn((v: string) => `decrypted:${v}`)
}))

import { resolveCloneToken } from './git-token'

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

describe('resolveCloneToken', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns decrypted token when connection exists', async () => {
		setupSelect([{ accessToken: 'encrypted-tok', provider: 'github' }])
		expect(await resolveCloneToken('conn-1')).toBe('decrypted:encrypted-tok')
	})

	it('returns null when connection is not found', async () => {
		setupSelect([])
		expect(await resolveCloneToken('missing')).toBeNull()
	})
})
