import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signInEmail: vi.fn(),
			signUpEmail: vi.fn(),
			signInSocial: vi.fn()
		}
	}
}))

import { auth } from '$lib/server/auth'
import { actions, load } from './+page.server'

function makeLoadEvent(user?: { id: string; email: string }) {
	return {
		locals: { user: user ?? null }
	} as unknown as Parameters<typeof load>[0]
}

function makeActionEvent(formEntries: Record<string, string>) {
	const formData = new FormData()
	for (const [key, value] of Object.entries(formEntries)) {
		formData.append(key, value)
	}
	return {
		request: {
			formData: () => Promise.resolve(formData)
		}
	} as unknown as Parameters<typeof actions.signInEmail>[0]
}

describe('demo better-auth login load', () => {
	it('redirects to demo page if already logged in', async () => {
		await expect(load(makeLoadEvent({ id: '1', email: 'a@b.com' }))).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth'
		})
	})

	it('returns empty object when not logged in', async () => {
		const result = await load(makeLoadEvent())
		expect(result).toEqual({})
	})
})

describe('demo better-auth login signInEmail action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('signs in and redirects on success', async () => {
		vi.mocked(auth.api.signInEmail).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signInEmail>>
		)

		await expect(
			actions.signInEmail(makeActionEvent({ email: 'a@b.com', password: 'validpassword1' }))
		).rejects.toMatchObject({ status: 302, location: '/demo/better-auth' })
	})

	it('returns 400 on API errors', async () => {
		const { APIError } = await import('better-auth/api')
		vi.mocked(auth.api.signInEmail).mockRejectedValue(
			new APIError('BAD_REQUEST', { message: 'Invalid credentials' })
		)

		const result = await actions.signInEmail(
			makeActionEvent({ email: 'a@b.com', password: 'wrongpassword1' })
		)
		expect(result).toMatchObject({ status: 400, data: { message: 'Invalid credentials' } })
	})

	it('returns 500 on unexpected errors', async () => {
		vi.mocked(auth.api.signInEmail).mockRejectedValue(new Error('DB down'))

		const result = await actions.signInEmail(
			makeActionEvent({ email: 'a@b.com', password: 'somepassword1' })
		)
		expect(result).toMatchObject({ status: 500, data: { message: 'Unexpected error' } })
	})
})

describe('demo better-auth login signUpEmail action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('signs up and redirects on success', async () => {
		vi.mocked(auth.api.signUpEmail).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signUpEmail>>
		)

		await expect(
			actions.signUpEmail(
				makeActionEvent({ email: 'a@b.com', password: 'validpassword1', name: 'Alice' })
			)
		).rejects.toMatchObject({ status: 302, location: '/demo/better-auth' })
	})

	it('returns 400 on API errors', async () => {
		const { APIError } = await import('better-auth/api')
		vi.mocked(auth.api.signUpEmail).mockRejectedValue(
			new APIError('BAD_REQUEST', { message: 'Email taken' })
		)

		const result = await actions.signUpEmail(
			makeActionEvent({ email: 'a@b.com', password: 'wrongpassword1', name: 'Alice' })
		)
		expect(result).toMatchObject({ status: 400, data: { message: 'Email taken' } })
	})

	it('returns 500 on unexpected errors', async () => {
		vi.mocked(auth.api.signUpEmail).mockRejectedValue(new Error('DB down'))

		const result = await actions.signUpEmail(
			makeActionEvent({ email: 'a@b.com', password: 'somepassword1', name: 'Alice' })
		)
		expect(result).toMatchObject({ status: 500, data: { message: 'Unexpected error' } })
	})
})

describe('demo better-auth login signInSocial action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('redirects to the provider url on success', async () => {
		vi.mocked(auth.api.signInSocial).mockResolvedValue({
			url: 'https://github.com/login/oauth/authorize'
		} as Awaited<ReturnType<typeof auth.api.signInSocial>>)

		await expect(
			actions.signInSocial(makeActionEvent({ provider: 'github' }))
		).rejects.toMatchObject({ status: 302, location: 'https://github.com/login/oauth/authorize' })
	})

	it('returns 400 when no url is returned', async () => {
		vi.mocked(auth.api.signInSocial).mockResolvedValue({
			url: undefined
		} as unknown as Awaited<ReturnType<typeof auth.api.signInSocial>>)

		const result = await actions.signInSocial(makeActionEvent({ provider: 'github' }))
		expect(result).toMatchObject({ status: 400, data: { message: 'Social sign-in failed' } })
	})
})
