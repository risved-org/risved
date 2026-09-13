import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

vi.mock('$lib/server/db', () => ({ db: mocks.db }));
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug', createdAt: 'created_at' },
	deployments: { id: 'id', projectId: 'project_id', status: 'status', createdAt: 'created_at' },
	envVars: { id: 'id', projectId: 'project_id', key: 'key' },
	buildLogs: { id: 'id', deploymentId: 'deployment_id' }
}));
vi.mock('drizzle-orm', () => ({
	and: vi.fn((...a: unknown[]) => ({ and: a })),
	asc: vi.fn((c: unknown) => ({ asc: c })),
	desc: vi.fn((c: unknown) => ({ desc: c })),
	eq: vi.fn((c: unknown, v: unknown) => ({ eq: [c, v] })),
	inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] }))
}));
vi.mock('$lib/server/pipeline', () => ({ runPipeline: mocks.runPipeline }));
vi.mock('$lib/server/pipeline/rollback', () => ({ runRollback: mocks.runRollback }));
vi.mock('$lib/server/pipeline/docker', () => ({ createCommandRunner: () => ({ exec: vi.fn() }) }));
vi.mock('$lib/server/pipeline/port', () => ({ allocatePort: mocks.allocatePort }));
vi.mock('$lib/server/pipeline/domains', () => ({ getManagedAppDomain: async () => null }));
vi.mock('$lib/server/git-repo', () => ({
	resolveGitHubRepo: mocks.resolveGitHubRepo,
	parseOwnerRepo: (input: string) => {
		const parts = input.trim().split('/');
		return parts.length === 2 && parts[0] && parts[1] ? { owner: parts[0], repo: parts[1] } : null;
	},
	gitInstallUrl: (origin: string) => `${origin}/settings/git`,
	createRemoteDetectionContext: () => ({
		fileExists: async () => false,
		readFile: async () => null
	})
}));
vi.mock('$lib/server/auto-webhook', () => ({ registerWebhook: mocks.registerWebhook }));
vi.mock('$lib/server/settings', () => ({ getSetting: mocks.getSetting }));
vi.mock('$lib/server/crypto', () => ({ encrypt: mocks.encrypt }));
vi.mock('$lib/server/detection', () => ({ detectFramework: mocks.detectFramework }));
vi.mock('$lib/server/detection/detectors', () => ({ detectors: [{ id: 'sveltekit' }] }));
vi.mock('$lib/server/hints', () => ({
	inspectRepoConfig: mocks.inspectRepoConfig,
	hintsFromLogs: () => []
}));
vi.mock('$lib/server/api-utils', () => ({
	slugify: (n: string) =>
		n
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, ''),
	generateWebhookSecret: () => 'secret'
}));

import {
	createProject,
	deployProject,
	getDeploymentDetail,
	isTerminalStatus,
	rollbackProject,
	ServiceError,
	setProjectEnv
} from './projects';

/**
 * A thenable stand-in for a drizzle query builder: every chain method returns
 * itself, and awaiting it yields the next queued result set.
 */
const selectQueue: unknown[][] = [];

function queueSelects(...results: unknown[][]) {
	selectQueue.length = 0;
	selectQueue.push(...results);
}

function makeChain(rows: unknown[]) {
	const chain: Record<string, unknown> = {};
	for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
		chain[method] = () => chain;
	}
	chain.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
		Promise.resolve(rows).then(resolve, reject);
	return chain;
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
};

beforeEach(() => {
	vi.clearAllMocks();
	selectQueue.length = 0;
	mocks.db.select.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
	mocks.db.insert.mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([project]),
			onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
			then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
		})
	});
	mocks.db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
	mocks.getSetting.mockResolvedValue(null);
	mocks.allocatePort.mockResolvedValue(3001);
	mocks.runPipeline.mockResolvedValue({ success: true, deploymentId: 'd-1', logs: [] });
	mocks.inspectRepoConfig.mockResolvedValue([]);
	mocks.detectFramework.mockResolvedValue({
		detected: true,
		framework: { id: 'sveltekit', name: 'SvelteKit', tier: 'node', confidence: 'high' }
	});
});

describe('isTerminalStatus', () => {
	it.each([
		['live', true],
		['failed', true],
		['stopped', true],
		['running', false],
		['pending', false]
	])('%s → %s', (status, expected) => {
		expect(isTerminalStatus(status)).toBe(expected);
	});
});

describe('createProject', () => {
	it('rejects a reference that is not owner/name', async () => {
		await expect(
			createProject({ repo: 'not-a-repo', origin: 'https://risved.test' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('reports github_app_not_installed with an install URL, writing nothing', async () => {
		mocks.resolveGitHubRepo.mockResolvedValue(null);

		const error = await createProject({
			repo: 'o/r',
			origin: 'https://risved.test'
		}).catch((e) => e as ServiceError);

		expect(error).toBeInstanceOf(ServiceError);
		expect((error as ServiceError).code).toBe('github_app_not_installed');
		expect((error as ServiceError).data.installUrl).toBe('https://risved.test/settings/git');
		expect(mocks.db.insert).not.toHaveBeenCalled();
	});

	it('refuses a duplicate slug', async () => {
		mocks.resolveGitHubRepo.mockResolvedValue({
			connectionId: 'c-1',
			client: {},
			repo: { name: 'my-app', default_branch: 'main', clone_url: 'https://github.com/o/r.git' }
		});
		queueSelects([project]);

		await expect(
			createProject({ repo: 'o/my-app', origin: 'https://risved.test' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('creates the project without deploying it', async () => {
		mocks.resolveGitHubRepo.mockResolvedValue({
			connectionId: 'c-1',
			client: {},
			repo: { name: 'my-app', default_branch: 'trunk', clone_url: 'https://github.com/o/r.git' }
		});
		mocks.inspectRepoConfig.mockResolvedValue([
			{ code: 'missing_adapter_node', severity: 'error', message: 'nope' }
		]);
		queueSelects([]);

		const result = await createProject({ repo: 'o/my-app', origin: 'https://risved.test' });

		expect(result.project.slug).toBe('my-app');
		expect(result.detectedFramework?.id).toBe('sveltekit');
		expect(result.buildHints).toHaveLength(1);
		expect(mocks.runPipeline).not.toHaveBeenCalled();
		expect(mocks.registerWebhook).toHaveBeenCalledOnce();
	});

	it("defaults the branch to the repo's default", async () => {
		mocks.resolveGitHubRepo.mockResolvedValue({
			connectionId: 'c-1',
			client: {},
			repo: { name: 'my-app', default_branch: 'trunk', clone_url: 'https://github.com/o/r.git' }
		});
		queueSelects([]);

		const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([project]) });
		mocks.db.insert.mockReturnValue({ values });

		await createProject({ repo: 'o/my-app', origin: 'https://risved.test' });

		expect(values.mock.calls[0][0]).toMatchObject({ branch: 'trunk' });
	});
});

describe('deployProject', () => {
	it('starts a deployment and returns immediately', async () => {
		/* project lookup, then the running-deployment check */
		queueSelects([project], []);

		const result = await deployProject('p-1');

		expect(result.status).toBe('running');
		expect(result.terminal).toBe(false);
		expect(result.deploymentId).toMatch(/^[0-9a-f-]{36}$/);
		expect(mocks.runPipeline).toHaveBeenCalledOnce();
	});

	it('refuses to stack a second build, naming the running one', async () => {
		queueSelects([project], [{ id: 'd-running', status: 'running' }]);

		const error = await deployProject('p-1').catch((e) => e as ServiceError);

		expect((error as ServiceError).code).toBe('deploy_in_progress');
		expect((error as ServiceError).data.deploymentId).toBe('d-running');
		expect(mocks.runPipeline).not.toHaveBeenCalled();
	});

	it('queues anyway when the caller allows it', async () => {
		queueSelects([project]);

		await expect(deployProject('p-1', { allowConcurrent: true })).resolves.toMatchObject({
			status: 'running'
		});
		expect(mocks.runPipeline).toHaveBeenCalledOnce();
	});

	it('passes ref through as the checkout ref', async () => {
		queueSelects([project], []);

		await deployProject('p-1', { ref: 'abc1234' });

		expect(mocks.runPipeline.mock.calls[0][0]).toMatchObject({ checkoutRef: 'abc1234' });
	});

	it('reports not_found for an unknown project', async () => {
		queueSelects([], []);

		await expect(deployProject('nope')).rejects.toMatchObject({ code: 'not_found' });
	});
});

describe('getDeploymentDetail', () => {
	const deployment = {
		id: 'd-1',
		projectId: 'p-1',
		status: 'failed',
		commitSha: 'abc1234',
		startedAt: '2026-01-01T10:00:00.000Z',
		finishedAt: '2026-01-01T10:02:00.000Z'
	};

	it('returns the log tail in reading order with terminal set', async () => {
		queueSelects(
			[deployment],
			[project],
			[
				{ id: 2, phase: 'build', message: 'second' },
				{ id: 1, phase: 'clone', message: 'first' }
			]
		);

		const detail = await getDeploymentDetail('d-1');

		expect(detail.terminal).toBe(true);
		expect(detail.logTail).toBe('[clone] first\n[build] second');
		expect(detail.url).toBe('https://my-app.example.com');
	});

	it('reports not_found for an unknown deployment', async () => {
		queueSelects([]);

		await expect(getDeploymentDetail('nope')).rejects.toMatchObject({ code: 'not_found' });
	});

	/** Record every `.limit(n)` the service issues; the last one is the log tail. */
	function trackLimits(): number[] {
		const seen: number[] = [];
		mocks.db.select.mockImplementation(() => {
			const rows = selectQueue.shift() ?? [];
			const chain: Record<string, unknown> = {};
			for (const method of ['from', 'where', 'orderBy']) chain[method] = () => chain;
			chain.limit = (n: number) => {
				seen.push(n);
				return Promise.resolve(rows);
			};
			chain.then = (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r);
			return chain;
		});
		return seen;
	}

	it('clamps logLines to the documented maximum', async () => {
		const limits = trackLimits();
		queueSelects([deployment], [project], []);

		await getDeploymentDetail('d-1', 9000);

		expect(limits.at(-1)).toBe(400);
	});

	it('defaults to 80 log lines and floors a nonsense value at 1', async () => {
		const defaults = trackLimits();
		queueSelects([deployment], [project], []);
		await getDeploymentDetail('d-1');
		expect(defaults.at(-1)).toBe(80);

		const floored = trackLimits();
		queueSelects([deployment], [project], []);
		await getDeploymentDetail('d-1', -5);
		expect(floored.at(-1)).toBe(1);
	});
});

describe('rollbackProject', () => {
	const target = {
		id: 'd-old',
		projectId: 'p-1',
		status: 'live',
		imageTag: 'img:1',
		commitSha: 'a'
	};

	it('redeploys the cached image', async () => {
		queueSelects([project], [target]);
		mocks.runRollback.mockResolvedValue({ success: true, deploymentId: 'd-new', logs: [] });

		const result = await rollbackProject('p-1', 'd-old');

		expect(result).toMatchObject({ deploymentId: 'd-new', status: 'live', terminal: true });
		expect(mocks.runRollback.mock.calls[0][0]).toMatchObject({ imageTag: 'img:1' });
	});

	it('refuses a deployment from another project', async () => {
		queueSelects([project], []);

		await expect(rollbackProject('p-1', 'd-foreign')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('refuses a deployment that never went live', async () => {
		queueSelects([project], [{ ...target, status: 'failed' }]);

		await expect(rollbackProject('p-1', 'd-old')).rejects.toMatchObject({ code: 'validation' });
	});

	it('refuses a deployment with no cached image', async () => {
		queueSelects([project], [{ ...target, imageTag: null }]);

		await expect(rollbackProject('p-1', 'd-old')).rejects.toMatchObject({ code: 'validation' });
	});

	it('surfaces a failed rollback as an internal error', async () => {
		queueSelects([project], [target]);
		mocks.runRollback.mockResolvedValue({
			success: false,
			deploymentId: 'd-new',
			error: 'health check failed',
			logs: []
		});

		await expect(rollbackProject('p-1', 'd-old')).rejects.toMatchObject({
			code: 'internal',
			message: 'health check failed'
		});
	});
});

describe('setProjectEnv', () => {
	it('upserts, removes and returns names only', async () => {
		queueSelects([project], [{ key: 'API_URL' }, { key: 'TOKEN' }]);

		const result = await setProjectEnv('p-1', { TOKEN: 'sekrit' }, ['OLD']);

		expect(result).toEqual({
			names: ['API_URL', 'TOKEN'],
			removed: ['OLD'],
			requiresRedeploy: true
		});
		expect(JSON.stringify(result)).not.toContain('sekrit');
		expect(mocks.encrypt).toHaveBeenCalledWith('sekrit');
	});

	it('rejects a name that is not a valid shell identifier', async () => {
		queueSelects([project]);

		await expect(setProjectEnv('p-1', { 'not valid': 'x' })).rejects.toMatchObject({
			code: 'validation'
		});
		expect(mocks.db.insert).not.toHaveBeenCalled();
	});

	it('rejects an invalid name in remove too', async () => {
		queueSelects([project]);

		await expect(setProjectEnv('p-1', {}, ['9LIVES'])).rejects.toMatchObject({
			code: 'validation'
		});
	});
});
