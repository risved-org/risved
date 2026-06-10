import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── DB mock ──────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([])
	/* orderBy must return a chainable object so where().orderBy().limit() works */
	const orderByMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }))
	const fromMock = vi.fn(() => ({ where: whereMock, orderBy: orderByMock }))
	const selectMock = vi.fn(() => ({ from: fromMock }))
	const deleteWhereMock = vi.fn().mockResolvedValue(undefined)
	const deleteMock = vi.fn(() => ({ where: deleteWhereMock }))
	const insertValuesMock = vi.fn().mockResolvedValue(undefined)
	const insertMock = vi.fn(() => ({ values: insertValuesMock }))
	const updateWhereMock = vi.fn().mockResolvedValue(undefined)
	const updateSetMock = vi.fn(() => ({ where: updateWhereMock }))
	const updateMock = vi.fn(() => ({ set: updateSetMock }))

	return {
		db: {
			select: selectMock,
			insert: insertMock,
			update: updateMock,
			delete: deleteMock,
			__limitMock: limitMock,
			__whereMock: whereMock,
			__orderByMock: orderByMock,
			__deleteWhereMock: deleteWhereMock,
			__insertValuesMock: insertValuesMock,
			__insertMock: insertMock,
			__updateSetMock: updateSetMock,
			__updateMock: updateMock
		}
	}
})

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq'),
	desc: vi.fn(() => 'desc')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_t',
	envVars: 'env_vars_t',
	domains: 'domains_t',
	cronJobs: 'cron_jobs_t',
	cronRuns: 'cron_runs_t',
	webhookDeliveries: 'webhook_deliveries_t',
	deployments: 'deployments_t'
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`),
	safeDecrypt: vi.fn((v: string) => v.replace(/^enc:/, ''))
}))

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn(() => ({
		deleteProjectJobs: vi.fn().mockResolvedValue(undefined)
	}))
}))

/* pipeline/docker is not mocked; try/catch blocks in delete make it safe */

import { db } from '$lib/server/db'
import { load, actions } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function resetChain() {
	dbAny.__limitMock.mockResolvedValue([])
	dbAny.__whereMock.mockImplementation(() => ({
		limit: dbAny.__limitMock,
		orderBy: dbAny.__orderByMock
	}))
	dbAny.__orderByMock.mockImplementation(() => ({
		limit: dbAny.__limitMock,
		orderBy: dbAny.__orderByMock
	}))
}

function makeRequest(fields: Record<string, string>) {
	const fd = new FormData()
	for (const [k, v] of Object.entries(fields)) fd.set(k, v)
	return { formData: () => Promise.resolve(fd) } as unknown as Request
}

/* ── load ─────────────────────────────────────────────────────────── */

describe('settings load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetChain()
	})

	it('throws 404 when project not found', async () => {
		await expect(
			load({ params: { slug: 'nope' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 })
	})

	it('returns settings data for a found project', async () => {
		const proj = {
			id: 'p1',
			slug: 'my-app',
			buildCommand: 'npm run build',
			startCommand: 'node .',
			releaseCommand: null,
			webhookSecret: null
		}
		/* call 1 — projects: where().limit(1) */
		dbAny.__whereMock.mockReturnValueOnce({
			limit: dbAny.__limitMock,
			orderBy: dbAny.__orderByMock
		})
		dbAny.__limitMock.mockResolvedValueOnce([proj])
		/* calls 2–4 — envVars, domains, cronJobs: where() resolves directly */
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([])
		/* call 5 — webhookDeliveries: where().orderBy().limit(1), all defaults → [] */

		const result = await load({ params: { slug: 'my-app' } } as Parameters<typeof load>[0])

		expect(result.settings.buildCommand).toBe('npm run build')
		expect(result.settings.startCommand).toBe('node .')
		expect(result.settings.releaseCommand).toBe('')
		expect(result.envVars).toEqual([])
		expect(result.domains).toEqual([])
		expect(result.cronJobs).toEqual([])
		expect(result.webhookActive).toBe(false)
	})

	it('sets webhookActive true when project has a webhookSecret', async () => {
		const proj = {
			id: 'p1',
			slug: 'x',
			buildCommand: null,
			startCommand: null,
			releaseCommand: null,
			webhookSecret: 'supersecret'
		}
		dbAny.__whereMock.mockReturnValueOnce({
			limit: dbAny.__limitMock,
			orderBy: dbAny.__orderByMock
		})
		dbAny.__limitMock.mockResolvedValueOnce([proj])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([])

		const result = await load({ params: { slug: 'x' } } as Parameters<typeof load>[0])
		expect(result.webhookActive).toBe(true)
	})

	it('decrypts env var values for display', async () => {
		const proj = {
			id: 'p1',
			slug: 'x',
			buildCommand: null,
			startCommand: null,
			releaseCommand: null,
			webhookSecret: null
		}
		dbAny.__whereMock.mockReturnValueOnce({
			limit: dbAny.__limitMock,
			orderBy: dbAny.__orderByMock
		})
		dbAny.__limitMock.mockResolvedValueOnce([proj])
		dbAny.__whereMock.mockResolvedValueOnce([
			{ id: 'e1', key: 'PORT', value: 'enc:3000', isSecret: false }
		])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([])

		const result = await load({ params: { slug: 'x' } } as Parameters<typeof load>[0])

		expect(result.envVars).toHaveLength(1)
		expect(result.envVars[0].key).toBe('PORT')
		expect(result.envVars[0].value).toBe('3000')
		expect(result.envVars[0].isSecret).toBe(false)
	})

	it('maps domain fields correctly', async () => {
		const proj = {
			id: 'p1',
			slug: 'x',
			buildCommand: null,
			startCommand: null,
			releaseCommand: null,
			webhookSecret: null
		}
		dbAny.__whereMock.mockReturnValueOnce({
			limit: dbAny.__limitMock,
			orderBy: dbAny.__orderByMock
		})
		dbAny.__limitMock.mockResolvedValueOnce([proj])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([
			{ id: 'd1', hostname: 'app.example.com', isPrimary: true, sslStatus: 'active' }
		])
		dbAny.__whereMock.mockResolvedValueOnce([])

		const result = await load({ params: { slug: 'x' } } as Parameters<typeof load>[0])

		expect(result.domains).toHaveLength(1)
		expect(result.domains[0].hostname).toBe('app.example.com')
		expect(result.domains[0].sslStatus).toBe('active')
	})

	it('includes cron jobs with null lastRun when no runs exist', async () => {
		const proj = {
			id: 'p1',
			slug: 'x',
			buildCommand: null,
			startCommand: null,
			releaseCommand: null,
			webhookSecret: null
		}
		const cronJob = {
			id: 'cj1',
			name: 'Nightly',
			route: '/api/nightly',
			method: 'GET',
			schedule: '0 0 * * *',
			timezone: 'UTC',
			enabled: true
		}
		dbAny.__whereMock.mockReturnValueOnce({
			limit: dbAny.__limitMock,
			orderBy: dbAny.__orderByMock
		})
		dbAny.__limitMock.mockResolvedValueOnce([proj])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([])
		dbAny.__whereMock.mockResolvedValueOnce([cronJob])
		/* cronRuns: where().orderBy().limit(1) — defaults yield [] */
		dbAny.__limitMock.mockResolvedValueOnce([])
		/* webhookDeliveries: where().orderBy().limit(1) — defaults yield [] */

		const result = await load({ params: { slug: 'x' } } as Parameters<typeof load>[0])

		expect(result.cronJobs).toHaveLength(1)
		expect(result.cronJobs[0].name).toBe('Nightly')
		expect(result.cronJobs[0].lastRun).toBeNull()
	})
})

/* ── saveScripts ──────────────────────────────────────────────────── */

describe('saveScripts action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetChain()
	})

	it('returns fail(404) when project not found', async () => {
		const result = await actions.saveScripts({
			params: { slug: 'nope' },
			request: makeRequest({ buildCommand: '', startCommand: '', releaseCommand: '' })
		} as Parameters<typeof actions.saveScripts>[0])
		expect(result).toMatchObject({ status: 404 })
	})

	it('updates script commands and returns scriptsSaved', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'p1', slug: 'my-app' }])

		const result = await actions.saveScripts({
			params: { slug: 'my-app' },
			request: makeRequest({
				buildCommand: 'npm run build',
				startCommand: 'node server.js',
				releaseCommand: 'npm run migrate'
			})
		} as Parameters<typeof actions.saveScripts>[0])

		expect(result).toMatchObject({ scriptsSaved: true })
		expect(dbAny.__updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				buildCommand: 'npm run build',
				startCommand: 'node server.js',
				releaseCommand: 'npm run migrate'
			})
		)
	})

	it('stores null for blank commands', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'p1', slug: 'my-app' }])

		await actions.saveScripts({
			params: { slug: 'my-app' },
			request: makeRequest({ buildCommand: '  ', startCommand: '', releaseCommand: '' })
		} as Parameters<typeof actions.saveScripts>[0])

		expect(dbAny.__updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				buildCommand: null,
				startCommand: null,
				releaseCommand: null
			})
		)
	})
})

/* ── saveEnv ──────────────────────────────────────────────────────── */

describe('saveEnv action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetChain()
	})

	it('returns fail(404) when project not found', async () => {
		const result = await actions.saveEnv({
			params: { slug: 'nope' },
			request: makeRequest({})
		} as Parameters<typeof actions.saveEnv>[0])
		expect(result).toMatchObject({ status: 404 })
	})

	it('deletes existing vars and inserts new ones', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'p1', slug: 'my-app' }])

		const fd = new FormData()
		fd.set('envKeys', 'PORT\x1FNODE_ENV')
		fd.set('envValues', '3000\x1Fproduction')
		fd.set('envSecrets', '0\x1F1')

		const result = await actions.saveEnv({
			params: { slug: 'my-app' },
			request: { formData: () => Promise.resolve(fd) }
		} as unknown as Parameters<typeof actions.saveEnv>[0])

		expect(result).toMatchObject({ envSaved: true })
		expect(db.delete).toHaveBeenCalled()
		expect(db.insert).toHaveBeenCalledTimes(2)
	})

	it('skips entries with invalid key names', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'p1', slug: 'my-app' }])

		const fd = new FormData()
		fd.set('envKeys', '123INVALID\x1FVALID_KEY')
		fd.set('envValues', 'a\x1Fb')
		fd.set('envSecrets', '0\x1F0')

		await actions.saveEnv({
			params: { slug: 'my-app' },
			request: { formData: () => Promise.resolve(fd) }
		} as unknown as Parameters<typeof actions.saveEnv>[0])

		expect(db.insert).toHaveBeenCalledTimes(1)
	})

	it('handles empty env submission by deleting all vars without inserting', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'p1', slug: 'my-app' }])

		const result = await actions.saveEnv({
			params: { slug: 'my-app' },
			request: makeRequest({})
		} as Parameters<typeof actions.saveEnv>[0])

		expect(result).toMatchObject({ envSaved: true })
		expect(db.delete).toHaveBeenCalled()
		expect(db.insert).not.toHaveBeenCalled()
	})
})
