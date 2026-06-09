import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mock handles ─────────────────────────────────────────── */

const { limitMock, whereMock, orderByMock, updateSetMock, insertValuesMock } = vi.hoisted(() => {
	const limitMock = vi.fn().mockResolvedValue([])
	const orderByMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
	const whereMock = vi.fn().mockReturnValue({ limit: limitMock, orderBy: orderByMock })
	const insertValuesMock = vi.fn().mockResolvedValue(undefined)
	const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
	return { limitMock, whereMock, orderByMock, updateSetMock, insertValuesMock }
})

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock, orderBy: orderByMock }) }),
		insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
		update: vi.fn().mockReturnValue({ set: updateSetMock }),
		delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
		__limitMock: limitMock,
		__whereMock: whereMock
	}
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args),
	desc: vi.fn(() => 'desc_fn')
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	domains: 'domains_table',
	envVars: { projectId: 'project_id', id: 'id', key: 'key', value: 'value', isSecret: 'is_secret' },
	webhookDeliveries: 'webhook_deliveries_table',
	cronJobs: { projectId: 'project_id', id: 'id' },
	cronRuns: { cronJobId: 'cron_job_id', startedAt: 'started_at' },
	settings: { key: 'key' }
}))

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`),
	safeDecrypt: vi.fn((v: string) => v.replace(/^enc:/, ''))
}))

vi.mock('$lib/server/cron', () => ({
	getCronScheduler: vi.fn().mockReturnValue({
		deleteProjectJobs: vi.fn().mockResolvedValue(undefined)
	})
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	dockerStop: vi.fn().mockResolvedValue(undefined),
	dockerVolumeRemove: vi.fn().mockResolvedValue(undefined),
	projectVolumeName: vi.fn((id: string) => `vol-${id}`)
}))

/* ── Helpers ──────────────────────────────────────────────────────── */

import { db } from '$lib/server/db'
import { load, actions } from './+page.server'

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>

function makeFormEvent(params: Record<string, string>, entries: Record<string, string> = {}) {
	const formData = new FormData()
	for (const [k, v] of Object.entries(entries)) formData.set(k, v)
	return { params, request: { formData: () => Promise.resolve(formData) } } as never
}

const sampleProject = {
	id: 'proj-1',
	name: 'Test App',
	slug: 'test-app',
	port: 3001,
	buildCommand: 'npm run build',
	startCommand: 'npm start',
	releaseCommand: null,
	webhookSecret: 'secret123'
}

/**
 * Queue up where/limit/orderBy mock returns for a full load() call.
 * load() makes these select calls in order:
 *  1. projects.where().limit(1)
 *  2. envVars.where()            — no limit
 *  3. domains.where()            — no limit
 *  4. cronJobs.where()           — no limit
 *  5+. cronRuns.where().orderBy().limit(1)  — one per cron job
 *  last. webhookDeliveries.where().orderBy().limit(1)
 */
function setupLoadMocks(
	project: typeof sampleProject | null,
	envVars: unknown[] = [],
	doms: unknown[] = [],
	crons: unknown[] = [],
	webhook: unknown[] = []
) {
	// Call 1: projects.where() → returns { limit, orderBy } then limit resolves project
	whereMock.mockReturnValueOnce({ limit: limitMock, orderBy: orderByMock })
	limitMock.mockResolvedValueOnce(project ? [project] : [])
	// Calls 2-4: direct array returns (no .limit())
	whereMock.mockReturnValueOnce(envVars)
	whereMock.mockReturnValueOnce(doms)
	whereMock.mockReturnValueOnce(crons)
	// For each cron job, there's a cronRuns query with orderBy().limit()
	for (const _cron of crons) {
		whereMock.mockReturnValueOnce({ limit: limitMock, orderBy: orderByMock })
		orderByMock.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
	}
	// Last: webhookDeliveries.where().orderBy().limit(1)
	orderByMock.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue(webhook) })
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('settings load', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		limitMock.mockResolvedValue([])
		orderByMock.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
		whereMock.mockReturnValue({ limit: limitMock, orderBy: orderByMock })
		dbAny.select.mockReturnValue({
			from: vi.fn().mockReturnValue({ where: whereMock, orderBy: orderByMock })
		})
	})

	it('throws 404 when project not found', async () => {
		whereMock.mockReturnValueOnce({ limit: limitMock, orderBy: orderByMock })
		limitMock.mockResolvedValueOnce([])
		await expect(
			load({ params: { slug: 'nonexistent' } } as never)
		).rejects.toMatchObject({ status: 404 })
	})

	it('returns settings for found project', async () => {
		setupLoadMocks(sampleProject)

		const result = (await load({ params: { slug: 'test-app' } } as never)) as {
			settings: { buildCommand: string; startCommand: string; releaseCommand: string }
			envVars: unknown[]
			domains: unknown[]
			cronJobs: unknown[]
			webhookActive: boolean
			lastWebhookAt: string | null
		}
		expect(result.settings.buildCommand).toBe('npm run build')
		expect(result.settings.startCommand).toBe('npm start')
		expect(result.settings.releaseCommand).toBe('')
		expect(result.envVars).toEqual([])
		expect(result.domains).toEqual([])
		expect(result.cronJobs).toEqual([])
		expect(result.webhookActive).toBe(true)
		expect(result.lastWebhookAt).toBeNull()
	})

	it('includes env vars in result', async () => {
		setupLoadMocks(
			sampleProject,
			[{ id: 'ev-1', key: 'SECRET_KEY', value: 'enc:mysecret', isSecret: true }]
		)

		const result = (await load({ params: { slug: 'test-app' } } as never)) as {
			envVars: Array<{ id: string; key: string; isSecret: boolean }>
		}
		expect(result.envVars).toHaveLength(1)
		expect(result.envVars[0].key).toBe('SECRET_KEY')
		expect(result.envVars[0].isSecret).toBe(true)
	})

	it('includes domains list', async () => {
		setupLoadMocks(
			sampleProject,
			[],
			[{ id: 'dom-1', hostname: 'app.example.com', isPrimary: true, sslStatus: 'active' }]
		)

		const result = (await load({ params: { slug: 'test-app' } } as never)) as {
			domains: Array<{ hostname: string; isPrimary: boolean }>
		}
		expect(result.domains).toHaveLength(1)
		expect(result.domains[0].hostname).toBe('app.example.com')
		expect(result.domains[0].isPrimary).toBe(true)
	})

	it('includes last webhook timestamp', async () => {
		setupLoadMocks(
			{ ...sampleProject, webhookSecret: 'abc' },
			[], [], [],
			[{ createdAt: '2026-05-01T10:00:00Z' }]
		)

		const result = (await load({ params: { slug: 'test-app' } } as never)) as {
			lastWebhookAt: string | null
		}
		expect(result.lastWebhookAt).toBe('2026-05-01T10:00:00Z')
	})

	it('webhookActive is false when no webhook secret', async () => {
		setupLoadMocks({ ...sampleProject, webhookSecret: null } as typeof sampleProject)

		const result = (await load({ params: { slug: 'test-app' } } as never)) as {
			webhookActive: boolean
		}
		expect(result.webhookActive).toBe(false)
	})
})

describe('settings saveScripts action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		limitMock.mockResolvedValue([])
		whereMock.mockReturnValue({ limit: limitMock, orderBy: orderByMock })
		dbAny.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) })
	})

	it('returns 404 when project not found', async () => {
		limitMock.mockResolvedValueOnce([])
		const result = await actions.saveScripts(makeFormEvent({ slug: 'ghost' }))
		expect(result).toMatchObject({ status: 404 })
	})

	it('updates build/start/release commands', async () => {
		limitMock.mockResolvedValueOnce([sampleProject])
		const result = await actions.saveScripts(
			makeFormEvent({ slug: 'test-app' }, {
				buildCommand: 'bun run build',
				startCommand: 'bun start',
				releaseCommand: 'bun run migrate'
			})
		)
		expect(result).toMatchObject({ scriptsSaved: true })
		expect(dbAny.update).toHaveBeenCalled()
	})

	it('saves empty commands as null', async () => {
		limitMock.mockResolvedValueOnce([sampleProject])
		await actions.saveScripts(makeFormEvent({ slug: 'test-app' }))
		const setCall = updateSetMock.mock.calls[0]?.[0] as Record<string, unknown>
		expect(setCall?.buildCommand).toBeNull()
		expect(setCall?.startCommand).toBeNull()
	})
})

describe('settings saveEnv action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		limitMock.mockResolvedValue([])
		whereMock.mockReturnValue({ limit: limitMock, orderBy: orderByMock })
		dbAny.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) })
		dbAny.insert.mockReturnValue({ values: insertValuesMock })
		dbAny.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
	})

	it('returns 404 when project not found', async () => {
		limitMock.mockResolvedValueOnce([])
		const result = await actions.saveEnv(makeFormEvent({ slug: 'ghost' }))
		expect(result).toMatchObject({ status: 404 })
	})

	it('deletes existing and inserts new env vars', async () => {
		limitMock.mockResolvedValueOnce([sampleProject])
		const result = await actions.saveEnv(
			makeFormEvent({ slug: 'test-app' }, {
				envKeys: 'DATABASE_URL\x1FSECRET',
				envValues: 'postgres://localhost/db\x1Fsupersecret',
				envSecrets: '0\x1F1'
			})
		)
		expect(result).toMatchObject({ envSaved: true })
		expect(dbAny.delete).toHaveBeenCalled()
		expect(dbAny.insert).toHaveBeenCalledTimes(2)
	})

	it('skips invalid key names', async () => {
		limitMock.mockResolvedValueOnce([sampleProject])
		await actions.saveEnv(
			makeFormEvent({ slug: 'test-app' }, {
				envKeys: '123INVALID\x1FVALID_KEY',
				envValues: 'bad\x1Fgood',
				envSecrets: '0\x1F0'
			})
		)
		expect(dbAny.insert).toHaveBeenCalledTimes(1)
	})

	it('handles empty env submission without inserting', async () => {
		limitMock.mockResolvedValueOnce([sampleProject])
		const result = await actions.saveEnv(makeFormEvent({ slug: 'test-app' }))
		expect(result).toMatchObject({ envSaved: true })
		expect(dbAny.delete).toHaveBeenCalled()
		expect(dbAny.insert).not.toHaveBeenCalled()
	})
})
