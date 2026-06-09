import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockVerifyForgejoToken, mockEncrypt } = vi.hoisted(() => ({
	mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	mockVerifyForgejoToken: vi.fn(),
	mockEncrypt: vi.fn((v: string) => `enc:${v}`)
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', accountName: 'account_name', provider: 'provider' }
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }))
vi.mock('$lib/server/forgejo', () => ({ verifyForgejoToken: mockVerifyForgejoToken }))
vi.mock('$lib/server/crypto', () => ({ encrypt: mockEncrypt }))
vi.mock('@sveltejs/kit', () => ({
	fail: vi.fn((status: number, data: unknown) => ({ status, data, isActionFailure: true }))
}))

function makeSelectChain(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue(rows)
	}
}

function makeSelectWithLimit(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	}
}

import { load, actions } from './+page.server'

beforeEach(() => vi.clearAllMocks())

describe('providers load', () => {
	it('returns empty connections when user is not logged in', async () => {
		const result = await load({ locals: { user: null } } as unknown as Parameters<typeof load>[0])
		expect(result.connections).toEqual([])
	})

	it('returns connections when user is authenticated', async () => {
		mockDb.select.mockReturnValue(makeSelectChain([
			{ id: 'c1', provider: 'github', accountName: 'alice', avatarUrl: null, createdAt: '2026-01-01' }
		]))

		const result = await load({ locals: { user: { id: 'u1' } } } as unknown as Parameters<typeof load>[0])
		expect(result.connections).toHaveLength(1)
		expect(result.connections[0].provider).toBe('github')
	})
})

describe('providers actions — forgejo', () => {
	it('returns 400 when instanceUrl is missing', async () => {
		const formData = new FormData()
		formData.set('token', 'tok')
		const result = await actions.forgejo({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 400 when token is missing', async () => {
		const formData = new FormData()
		formData.set('instanceUrl', 'https://codeberg.org')
		const result = await actions.forgejo({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 400 for invalid URL format', async () => {
		const formData = new FormData()
		formData.set('instanceUrl', 'not-a-url')
		formData.set('token', 'tok')
		const result = await actions.forgejo({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ status: 400 })
	})

	it('returns 400 when token verification fails', async () => {
		mockVerifyForgejoToken.mockRejectedValueOnce(new Error('bad token'))
		const formData = new FormData()
		formData.set('instanceUrl', 'https://codeberg.org')
		formData.set('token', 'bad-tok')
		const result = await actions.forgejo({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ status: 400 })
	})

	it('inserts new connection on success', async () => {
		mockVerifyForgejoToken.mockResolvedValueOnce({ login: 'alice', avatar_url: 'https://a.co/img.png' })
		mockDb.select.mockReturnValue(makeSelectWithLimit([]))
		mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

		const formData = new FormData()
		formData.set('instanceUrl', 'https://codeberg.org')
		formData.set('token', 'good-tok')
		const result = await actions.forgejo({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
	})

	it('updates existing connection', async () => {
		mockVerifyForgejoToken.mockResolvedValueOnce({ login: 'alice', avatar_url: '' })
		mockDb.select.mockReturnValue(makeSelectWithLimit([{ id: 'conn-1' }]))
		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		})

		const formData = new FormData()
		formData.set('instanceUrl', 'https://codeberg.org')
		formData.set('token', 'tok')
		const result = await actions.forgejo({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ forgejoConnected: true })
		expect(mockDb.update).toHaveBeenCalled()
	})
})

describe('providers actions — disconnect', () => {
	it('returns 400 when connectionId is missing', async () => {
		const formData = new FormData()
		const result = await actions.disconnect({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ status: 400 })
	})

	it('deletes connection and returns success', async () => {
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const formData = new FormData()
		formData.set('connectionId', 'conn-1')
		const result = await actions.disconnect({ request: { formData: () => formData } } as never)
		expect(result).toMatchObject({ disconnected: true })
	})
})
