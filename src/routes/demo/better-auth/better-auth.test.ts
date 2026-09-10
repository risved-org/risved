import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signOut: vi.fn()
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

function makeActionEvent() {
	return {
		request: { headers: new Headers() }
	} as unknown as Parameters<typeof actions.signOut>[0]
}

describe('demo better-auth load', () => {
	it('redirects to login if not logged in', async () => {
		await expect(load(makeLoadEvent())).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth/login'
		})
	})

	it('returns the user when logged in', async () => {
		const user = { id: '1', email: 'a@b.com' }
		const result = await load(makeLoadEvent(user))
		expect(result).toEqual({ user })
	})
})

describe('demo better-auth signOut action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('signs out and redirects to login', async () => {
		vi.mocked(auth.api.signOut).mockResolvedValue(undefined as never)

		await expect(actions.signOut(makeActionEvent())).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth/login'
		})
		expect(auth.api.signOut).toHaveBeenCalledOnce()
	})
})
