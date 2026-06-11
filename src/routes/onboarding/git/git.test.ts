import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/auth-utils', () => ({
	isFirstRun: vi.fn().mockResolvedValue(false)
}))

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }) }
}))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accountName: 'account_name', avatarUrl: 'avatar_url' }
}))

vi.mock('$env/dynamic/private', () => ({ env: {} }))

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null)
}))

vi.mock('$lib/server/git-actions', () => ({
	connectForgejo: vi.fn().mockResolvedValue({ connected: true }),
	saveGithubApp: vi.fn().mockResolvedValue({ savedGithub: true }),
	saveGitlabApp: vi.fn().mockResolvedValue({ savedGitlab: true })
}))

import { isFirstRun } from '$lib/server/auth-utils'
import { getSetting } from '$lib/server/settings'
import { load, actions } from './+page.server'

describe('onboarding/git load', () => {
	beforeEach(() => vi.clearAllMocks())

	it('redirects to /onboarding on first run', async () => {
		vi.mocked(isFirstRun).mockResolvedValueOnce(true)
		await expect(load()).rejects.toMatchObject({ status: 303, location: '/onboarding' })
	})

	it('returns connections list when not first run', async () => {
		const result = (await load()) as { connections: unknown[]; isCloud: boolean; domainMode: string }
		expect(result.connections).toEqual([])
		expect(result.isCloud).toBe(false)
		expect(result.domainMode).toBe('subdomain')
	})

	it('parses domain_config mode from settings', async () => {
		vi.mocked(getSetting).mockResolvedValueOnce(JSON.stringify({ mode: 'ip' }))
		const result = (await load()) as { domainMode: string }
		expect(result.domainMode).toBe('ip')
	})

	it('uses default domainMode when settings JSON is invalid', async () => {
		vi.mocked(getSetting).mockResolvedValueOnce('not-valid-json')
		const result = (await load()) as { domainMode: string }
		expect(result.domainMode).toBe('subdomain')
	})

	it('uses default domainMode when settings returns null', async () => {
		vi.mocked(getSetting).mockResolvedValueOnce(null)
		const result = (await load()) as { domainMode: string }
		expect(result.domainMode).toBe('subdomain')
	})
})

describe('onboarding/git actions', () => {
	beforeEach(() => vi.clearAllMocks())

	it('skip redirects to /onboarding/deploy', async () => {
		await expect(actions.skip(null as never)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/deploy'
		})
	})

	it('forgejo delegates to connectForgejo', async () => {
		const formData = new FormData()
		const result = await actions.forgejo({
			request: { formData: () => Promise.resolve(formData) }
		} as never)
		expect(result).toMatchObject({ connected: true })
	})

	it('saveGithubApp delegates to saveGithubApp', async () => {
		const formData = new FormData()
		const result = await actions.saveGithubApp({
			request: { formData: () => Promise.resolve(formData) }
		} as never)
		expect(result).toMatchObject({ savedGithub: true })
	})

	it('saveGitlabApp delegates to saveGitlabApp', async () => {
		const formData = new FormData()
		const result = await actions.saveGitlabApp({
			request: { formData: () => Promise.resolve(formData) }
		} as never)
		expect(result).toMatchObject({ savedGitlab: true })
	})
})
