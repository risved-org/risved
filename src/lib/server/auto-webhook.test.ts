import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockCreateWebhook, mockListWebhooks, mockUpdateWebhook } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockCreateWebhook: vi.fn(),
	mockListWebhooks: vi.fn(),
	mockUpdateWebhook: vi.fn()
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
vi.mock('$lib/server/github', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	GitHubClient: vi.fn().mockImplementation(function (this: any) {
		this.createWebhook = mockCreateWebhook
		this.listWebhooks = mockListWebhooks
		this.updateWebhook = mockUpdateWebhook
	})
}))

import { registerWebhook, repairWebhook } from './auto-webhook'

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

const BASE_OPTS = {
	connectionId: 'conn-1',
	repoUrl: 'https://github.com/owner/repo.git',
	projectId: 'proj-1',
	webhookSecret: 'sec-123',
	origin: 'https://example.com'
}

describe('registerWebhook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateWebhook.mockResolvedValue({ id: 1 })
	})

	it('does nothing when connection is not found', async () => {
		setupSelect([])
		await registerWebhook(BASE_OPTS)
		expect(mockCreateWebhook).not.toHaveBeenCalled()
	})

	it('creates a webhook for a GitHub connection', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		await registerWebhook(BASE_OPTS)
		expect(mockCreateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({
				owner: 'owner',
				repo: 'repo',
				webhookUrl: 'https://example.com/api/webhooks/proj-1',
				secret: 'sec-123'
			})
		)
	})

	it('skips webhook for non-GitHub URL even with github provider', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		await registerWebhook({ ...BASE_OPTS, repoUrl: 'not-a-url' })
		expect(mockCreateWebhook).not.toHaveBeenCalled()
	})

	it('skips webhook for non-github provider', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'forgejo' }])
		await registerWebhook(BASE_OPTS)
		expect(mockCreateWebhook).not.toHaveBeenCalled()
	})

	it('swallows errors without throwing', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		mockCreateWebhook.mockRejectedValue(new Error('network failure'))
		await expect(registerWebhook(BASE_OPTS)).resolves.toBeUndefined()
	})
})

describe('repairWebhook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateWebhook.mockResolvedValue({ id: 1 })
		mockUpdateWebhook.mockResolvedValue({ id: 1 })
		mockListWebhooks.mockResolvedValue([])
	})

	const REPAIR_OPTS = { ...BASE_OPTS }

	it('fails when no connection is linked', async () => {
		const result = await repairWebhook({ ...REPAIR_OPTS, connectionId: null })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toMatch(/No Git connection/i)
		expect(mockListWebhooks).not.toHaveBeenCalled()
	})

	it('fails when the connection no longer exists', async () => {
		setupSelect([])
		const result = await repairWebhook(REPAIR_OPTS)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toMatch(/no longer exists/i)
	})

	it('fails for a non-github provider', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'gitlab' }])
		const result = await repairWebhook(REPAIR_OPTS)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toMatch(/only available for GitHub/i)
	})

	it('creates a webhook when none matches the payload URL', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		mockListWebhooks.mockResolvedValue([
			{ id: 9, active: true, events: ['push'], config: { url: 'https://other.example/hook' } }
		])
		const result = await repairWebhook(REPAIR_OPTS)
		expect(result).toEqual({ ok: true, action: 'created' })
		expect(mockCreateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({
				owner: 'owner',
				repo: 'repo',
				webhookUrl: 'https://example.com/api/webhooks/proj-1',
				secret: 'sec-123'
			})
		)
		expect(mockUpdateWebhook).not.toHaveBeenCalled()
	})

	it('updates the existing webhook that matches the payload URL', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		mockListWebhooks.mockResolvedValue([
			{
				id: 42,
				active: false,
				events: ['push'],
				config: { url: 'https://example.com/api/webhooks/proj-1' }
			}
		])
		const result = await repairWebhook(REPAIR_OPTS)
		expect(result).toEqual({ ok: true, action: 'updated' })
		expect(mockUpdateWebhook).toHaveBeenCalledWith(
			expect.objectContaining({
				hookId: 42,
				webhookUrl: 'https://example.com/api/webhooks/proj-1',
				secret: 'sec-123'
			})
		)
		expect(mockCreateWebhook).not.toHaveBeenCalled()
	})

	it('returns a failure reason when GitHub cannot be reached', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		mockListWebhooks.mockRejectedValue(new Error('401 Bad credentials'))
		const result = await repairWebhook(REPAIR_OPTS)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toMatch(/401 Bad credentials/)
	})

	it('fails when repo URL is not a github URL', async () => {
		setupSelect([{ accessToken: 'enc-tok', provider: 'github' }])
		const result = await repairWebhook({ ...REPAIR_OPTS, repoUrl: 'not-a-url' })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toMatch(/repository/i)
	})
})
