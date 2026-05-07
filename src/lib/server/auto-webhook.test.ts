import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockCreateWebhook } = vi.hoisted(() => ({
	mockDb: { select: vi.fn() },
	mockCreateWebhook: vi.fn()
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
	})
}))

import { registerWebhook } from './auto-webhook'

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
