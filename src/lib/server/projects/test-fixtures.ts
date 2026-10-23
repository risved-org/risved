import { beforeEach, vi } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
	db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	runPipeline: vi.fn(),
	runRollback: vi.fn(),
	resolveGitHubRepo: vi.fn(),
	registerWebhook: vi.fn(),
	getSetting: vi.fn(),
	allocatePort: vi.fn(),
	encrypt: vi.fn((v: string) => `enc(${v})`),
	detectFramework: vi.fn(),
	inspectRepoConfig: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mocks.db }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug', createdAt: 'created_at' },
	deployments: { id: 'id', projectId: 'project_id', status: 'status', createdAt: 'created_at' },
	envVars: { id: 'id', projectId: 'project_id', key: 'key' },
	buildLogs: { id: 'id', deploymentId: 'deployment_id' }
}))
vi.mock('drizzle-orm', () => ({
	sql: Object.assign(
		vi.fn((strings, ...values) => ({ strings, values })),
		{ raw: vi.fn((value) => ({ raw: value })) }
	),
	and: vi.fn((...a: unknown[]) => ({ and: a })),
	asc: vi.fn((c: unknown) => ({ asc: c })),
	desc: vi.fn((c: unknown) => ({ desc: c })),
	eq: vi.fn((c: unknown, v: unknown) => ({ eq: [c, v] })),
	inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] }))
}))
vi.mock('$lib/server/pipeline', () => ({ runPipeline: mocks.runPipeline }))
vi.mock('$lib/server/pipeline/rollback', () => ({ runRollback: mocks.runRollback }))
vi.mock('$lib/server/pipeline/docker', () => ({ createCommandRunner: () => ({ exec: vi.fn() }) }))
vi.mock('$lib/server/pipeline/port', () => ({ allocatePort: mocks.allocatePort }))
vi.mock('$lib/server/pipeline/domains', () => ({ getManagedAppDomain: async () => null }))
vi.mock('$lib/server/git-repo', () => ({
	resolveGitHubRepo: mocks.resolveGitHubRepo,
	parseOwnerRepo: (input: string) => {
		const parts = input.trim().split('/')
		return parts.length === 2 && parts[0] && parts[1] ? { owner: parts[0], repo: parts[1] } : null
	},
	gitInstallUrl: (origin: string) => `${origin}/settings/git`,
	createRemoteDetectionContext: () => ({
		fileExists: async () => false,
		readFile: async () => null
	})
}))
vi.mock('$lib/server/auto-webhook', () => ({ registerWebhook: mocks.registerWebhook }))
vi.mock('$lib/server/settings', () => ({ getSetting: mocks.getSetting }))
vi.mock('$lib/server/crypto', () => ({ encrypt: mocks.encrypt }))
vi.mock('$lib/server/detection', () => ({ detectFramework: mocks.detectFramework }))
vi.mock('$lib/server/detection/detectors', () => ({ detectors: [{ id: 'sveltekit' }] }))
vi.mock('$lib/server/hints', () => ({
	inspectRepoConfig: mocks.inspectRepoConfig,
	hintsFromLogs: () => []
}))
vi.mock('$lib/server/api-utils', () => ({
	slugify: (n: string) =>
		n
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, ''),
	generateWebhookSecret: () => 'secret'
}))

/**
 * A thenable stand-in for a drizzle query builder: every chain method returns
 * itself, and awaiting it yields the next queued result set.
 */
const selectQueue: unknown[][] = []

function queueSelects(...results: unknown[][]) {
	selectQueue.length = 0
	selectQueue.push(...results)
}

function makeChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
		chain[method] = () => chain
	}
	chain.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
		Promise.resolve(rows).then(resolve, reject)
	return chain
}

const project = {
	id: 'p-1',
	name: 'My App',
	slug: 'my-app',
	repoUrl: 'https://github.com/o/r.git',
	branch: 'main',
	gitConnectionId: 'c-1',
	frameworkId: 'sveltekit',
	tier: 'node',
	port: 3001,
	domain: 'my-app.example.com',
	buildCommand: null,
	startCommand: null,
	releaseCommand: null,
	postgresEnabled: false,
	postgresPassword: null,
	createdAt: '2026-01-01T00:00:00.000Z'
}

beforeEach(() => {
	vi.clearAllMocks()
	selectQueue.length = 0
	mocks.db.select.mockImplementation(() => makeChain(selectQueue.shift() ?? []))
	mocks.db.insert.mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([project]),
			onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
			then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
		})
	})
	mocks.db.update.mockReturnValue({
		set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
	})
	mocks.db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
	mocks.getSetting.mockResolvedValue(null)
	mocks.allocatePort.mockResolvedValue(3001)
	mocks.runPipeline.mockResolvedValue({ success: true, deploymentId: 'd-1', logs: [] })
	mocks.inspectRepoConfig.mockResolvedValue([])
	mocks.detectFramework.mockResolvedValue({
		detected: true,
		framework: { id: 'sveltekit', name: 'SvelteKit', tier: 'node', confidence: 'high' }
	})
})

export { mocks, project, queueSelects, selectQueue }
