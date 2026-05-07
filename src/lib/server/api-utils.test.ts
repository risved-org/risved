import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}))

vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init)),
	error: vi.fn((status: number, message: string) => {
		throw Object.assign(new Error(message), { status })
	})
}))

import { getSetting } from '$lib/server/settings'
import { requireAuth, slugify, generateWebhookSecret, jsonError } from './api-utils'

function makeEvent(overrides: {
	user?: App.Locals['user'] | null
	authorization?: string
} = {}) {
	return {
		locals: { user: overrides.user ?? null },
		request: {
			headers: new Headers(
				overrides.authorization ? { authorization: overrides.authorization } : {}
			)
		}
	} as Parameters<typeof requireAuth>[0]
}

describe('requireAuth', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns user when session user is present', async () => {
		const user = { id: 'u1', email: 'a@b.com', name: 'A' }
		const result = await requireAuth(makeEvent({ user: user as App.Locals['user'] }))
		expect(result).toBe(user)
	})

	it('authenticates via valid Bearer token', async () => {
		vi.mocked(getSetting).mockResolvedValue('rsv_secret')
		const result = await requireAuth(makeEvent({ authorization: 'Bearer rsv_secret' }))
		expect(result).toMatchObject({ id: 'api-token', email: 'api@risved.local' })
	})

	it('throws 401 for wrong Bearer token', async () => {
		vi.mocked(getSetting).mockResolvedValue('rsv_secret')
		await expect(
			requireAuth(makeEvent({ authorization: 'Bearer wrong' }))
		).rejects.toMatchObject({ status: 401 })
	})

	it('throws 401 when no auth header and no stored token', async () => {
		vi.mocked(getSetting).mockResolvedValue(null)
		await expect(requireAuth(makeEvent())).rejects.toMatchObject({ status: 401 })
	})

	it('throws 401 when no Bearer prefix', async () => {
		vi.mocked(getSetting).mockResolvedValue('token')
		await expect(requireAuth(makeEvent({ authorization: 'Basic token' }))).rejects.toMatchObject({
			status: 401
		})
	})
})

describe('slugify', () => {
	it('lowercases and replaces spaces with hyphens', () => {
		expect(slugify('My Cool App')).toBe('my-cool-app')
	})

	it('strips leading and trailing hyphens', () => {
		expect(slugify('--hello world--')).toBe('hello-world')
	})

	it('collapses consecutive non-alphanumeric chars', () => {
		expect(slugify('foo!!!bar')).toBe('foo-bar')
	})

	it('truncates to 63 characters', () => {
		expect(slugify('a'.repeat(100))).toHaveLength(63)
	})

	it('handles already-slugified input', () => {
		expect(slugify('my-app')).toBe('my-app')
	})
})

describe('generateWebhookSecret', () => {
	it('returns a 64-char hex string', () => {
		const secret = generateWebhookSecret()
		expect(secret).toHaveLength(64)
		expect(secret).toMatch(/^[0-9a-f]+$/)
	})

	it('generates unique secrets each call', () => {
		expect(generateWebhookSecret()).not.toBe(generateWebhookSecret())
	})
})

describe('jsonError', () => {
	it('returns a Response with the given status', async () => {
		const res = jsonError(404, 'Not found')
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body).toEqual({ error: 'Not found' })
	})

	it('works for 400 errors', async () => {
		const res = jsonError(400, 'Bad request')
		expect(res.status).toBe(400)
	})
})
