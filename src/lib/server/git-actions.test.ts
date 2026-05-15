import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── hoisted mock primitives ──────────────────────────────────────── */

const mockSelect = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())

vi.mock('$lib/server/db', () => ({
	db: { select: mockSelect, insert: mockInsert, update: mockUpdate }
}))

vi.mock('$lib/server/db/schema', () => ({
	gitConnections: 'git_connections_table'
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => 'eq_fn') }))

vi.mock('$lib/server/forgejo', () => ({
	verifyForgejoToken: vi.fn()
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`)
}))

vi.mock('$lib/server/settings', () => ({
	setSetting: vi.fn().mockResolvedValue(undefined)
}))

import { connectForgejo, saveGithubApp, saveGitlabApp } from './git-actions'
import { verifyForgejoToken } from '$lib/server/forgejo'
import { setSetting } from '$lib/server/settings'

function makeForm(data: Record<string, string>): FormData {
	const fd = new FormData()
	for (const [k, v] of Object.entries(data)) fd.append(k, v)
	return fd
}

function setupSelectChain(rows: unknown[]) {
	const limitMock = vi.fn().mockResolvedValue(rows)
	const whereMock = vi.fn(() => ({ limit: limitMock }))
	const fromMock = vi.fn(() => ({ where: whereMock }))
	mockSelect.mockReturnValue({ from: fromMock })
}

function setupInsertChain() {
	const valuesMock = vi.fn().mockResolvedValue(undefined)
	mockInsert.mockReturnValue({ values: valuesMock })
}

function setupUpdateChain() {
	const whereMock = vi.fn().mockResolvedValue(undefined)
	const setMock = vi.fn(() => ({ where: whereMock }))
	mockUpdate.mockReturnValue({ set: setMock })
}

/* ── connectForgejo ───────────────────────────────────────────────── */

describe('connectForgejo', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when instanceUrl is missing', async () => {
		const result = await connectForgejo(makeForm({ token: 'tok' }))
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.any(String) } })
	})

	it('returns 400 when token is missing', async () => {
		const result = await connectForgejo(makeForm({ instanceUrl: 'https://forgejo.example.com' }))
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.any(String) } })
	})

	it('returns 400 for an invalid URL', async () => {
		const result = await connectForgejo(
			makeForm({ instanceUrl: 'not-a-url', token: 'tok' })
		)
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.stringContaining('Invalid URL') } })
	})

	it('returns 400 when verifyForgejoToken throws', async () => {
		vi.mocked(verifyForgejoToken).mockRejectedValueOnce(new Error('network error'))
		const result = await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com', token: 'bad-tok' })
		)
		expect(result).toMatchObject({ status: 400, data: { forgejoError: expect.any(String) } })
	})

	it('inserts a new connection when none exists', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValueOnce({
			login: 'alice',
			avatar_url: 'https://avatar.url'
		})
		setupSelectChain([])
		setupInsertChain()

		const result = await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com/', token: 'good-tok' })
		)
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
		expect(mockInsert).toHaveBeenCalledWith('git_connections_table')
	})

	it('updates an existing connection when one exists', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValueOnce({
			login: 'alice',
			avatar_url: 'https://avatar.url'
		})
		setupSelectChain([{ id: 'conn-1', accountName: 'alice' }])
		setupUpdateChain()

		const result = await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com', token: 'good-tok' })
		)
		expect(result).toMatchObject({ forgejoConnected: true, accountName: 'alice' })
		expect(mockUpdate).toHaveBeenCalledWith('git_connections_table')
	})

	it('strips trailing slash from instance URL', async () => {
		vi.mocked(verifyForgejoToken).mockResolvedValueOnce({
			login: 'bob',
			avatar_url: ''
		})
		setupSelectChain([])
		const valuesMock = vi.fn().mockResolvedValue(undefined)
		mockInsert.mockReturnValue({ values: valuesMock })

		await connectForgejo(
			makeForm({ instanceUrl: 'https://forgejo.example.com///', token: 'tok' })
		)
		expect(valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ instanceUrl: 'https://forgejo.example.com' })
		)
	})
})

/* ── saveGithubApp ────────────────────────────────────────────────── */

describe('saveGithubApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when any field is missing', async () => {
		const result = await saveGithubApp(makeForm({ appId: '123' }))
		expect(result).toMatchObject({ status: 400, data: { githubAppError: expect.any(String) } })
	})

	it('saves settings when all fields provided', async () => {
		const result = await saveGithubApp(
			makeForm({
				appId: '123',
				privateKey: 'pem-key',
				clientId: 'cid',
				clientSecret: 'csec'
			})
		)
		expect(result).toMatchObject({ githubAppSaved: true })
		expect(setSetting).toHaveBeenCalledWith('github_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('github_app_id', '123')
		expect(setSetting).toHaveBeenCalledWith('github_app_private_key', 'enc:pem-key')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_id', 'cid')
		expect(setSetting).toHaveBeenCalledWith('github_app_client_secret', 'enc:csec')
	})
})

/* ── saveGitlabApp ────────────────────────────────────────────────── */

describe('saveGitlabApp', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns 400 when any field is missing', async () => {
		const result = await saveGitlabApp(makeForm({ instanceUrl: 'https://gitlab.example.com' }))
		expect(result).toMatchObject({ status: 400, data: { gitlabAppError: expect.any(String) } })
	})

	it('returns 400 for an invalid instanceUrl', async () => {
		const result = await saveGitlabApp(
			makeForm({ instanceUrl: 'not-a-url', applicationId: 'aid', secret: 'sec' })
		)
		expect(result).toMatchObject({ status: 400, data: { gitlabAppError: expect.stringContaining('Invalid URL') } })
	})

	it('saves settings when all fields are valid', async () => {
		const result = await saveGitlabApp(
			makeForm({
				instanceUrl: 'https://gitlab.example.com/',
				applicationId: 'app-id',
				secret: 'my-secret'
			})
		)
		expect(result).toMatchObject({ gitlabAppSaved: true })
		expect(setSetting).toHaveBeenCalledWith('gitlab_app_mode', 'custom')
		expect(setSetting).toHaveBeenCalledWith('gitlab_instance_url', 'https://gitlab.example.com')
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_id', 'app-id')
		expect(setSetting).toHaveBeenCalledWith('gitlab_client_secret', 'enc:my-secret')
	})
})
