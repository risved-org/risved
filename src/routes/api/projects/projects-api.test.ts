import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
};

/* Chain: select().from().where().limit() / orderBy() */
function setupSelectChain(rows: unknown[]) {
	const chain = {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			}),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	};
	mockDb.select.mockReturnValue(chain);
	return chain;
}

vi.mock('$lib/server/db', () => ({ db: mockDb }));

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', slug: 'slug', port: 'port', createdAt: 'created_at' },
	deployments: { id: 'id', projectId: 'project_id', createdAt: 'created_at' },
	buildLogs: { deploymentId: 'deployment_id', timestamp: 'timestamp' },
	envVars: { id: 'id', projectId: 'project_id', key: 'key' }
}));

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockReturnValue({ id: 'user-1', email: 'admin@test.com' }),
	slugify: vi.fn().mockReturnValue('my-app'),
	generateWebhookSecret: vi.fn().mockReturnValue('secret-abc'),
	jsonError: vi.fn((status: number, message: string) => {
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	})
}));

vi.mock('$lib/server/pipeline/port', () => ({
	allocatePort: vi.fn().mockResolvedValue(3001)
}));

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue({
		success: true,
		deploymentId: 'd-1',
		error: undefined
	})
}));

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	dockerStop: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('$lib/server/caddy', () => ({
	CaddyClient: vi.fn().mockImplementation(() => ({
		removeRoute: vi.fn().mockResolvedValue({ success: true })
	}))
}));

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(overrides: {
	method?: string;
	body?: unknown;
	params?: Record<string, string>;
} = {}) {
	const { method = 'GET', body, params = {} } = overrides;
	return {
		request: new Request('http://localhost/api/projects', {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		}),
		locals: { user: { id: 'user-1', email: 'admin@test.com' }, session: {} },
		params,
		url: new URL('http://localhost/api/projects')
	} as never;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('GET /api/projects', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns list of projects', async () => {
		const projectRows = [
			{ id: 'p-1', name: 'App 1', slug: 'app-1' },
			{ id: 'p-2', name: 'App 2', slug: 'app-2' }
		];
		setupSelectChain(projectRows);

		const { GET } = await import('./+server');
		const res = await GET(makeEvent());

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual(projectRows);
	});
});

describe('POST /api/projects', () => {
	beforeEach(() => vi.clearAllMocks());

	it('creates a project with valid input', async () => {
		/* No duplicate slug */
		setupSelectChain([]);

		mockDb.insert.mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([
					{
						id: 'p-1',
						name: 'My App',
						slug: 'my-app',
						repoUrl: 'https://github.com/user/repo.git',
						branch: 'main',
						port: 3001,
						webhookSecret: 'secret-abc'
					}
				])
			})
		});

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				body: { name: 'My App', git_url: 'https://github.com/user/repo.git' }
			})
		);

		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.name).toBe('My App');
		expect(data.slug).toBe('my-app');
	});

	it('returns 400 when name is missing', async () => {
		const { POST } = await import('./+server');
		const res = await POST(makeEvent({ method: 'POST', body: { git_url: 'https://x.com/r.git' } }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when git_url is missing', async () => {
		const { POST } = await import('./+server');
		const res = await POST(makeEvent({ method: 'POST', body: { name: 'Test' } }));
		expect(res.status).toBe(400);
	});

	it('returns 409 on duplicate slug', async () => {
		setupSelectChain([{ id: 'p-existing', slug: 'my-app' }]);

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				body: { name: 'My App', git_url: 'https://github.com/user/repo.git' }
			})
		);

		expect(res.status).toBe(409);
	});
});

describe('GET /api/projects/:id', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns project with latest deployment', async () => {
		const project = { id: 'p-1', name: 'My App', slug: 'my-app' };
		const deployment = { id: 'd-1', status: 'live' };

		/* First select: project lookup; second select: latest deployment */
		let callCount = 0;
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockImplementation(() => {
						callCount++;
						return callCount === 1 ? Promise.resolve([project]) : Promise.resolve([deployment]);
					}),
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([deployment])
					})
				})
			})
		}));

		const { GET } = await import('./[id]/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe('p-1');
		expect(data.latestDeployment).toBeTruthy();
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { GET } = await import('./[id]/+server');
		const res = await GET(makeEvent({ params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

describe('PUT /api/projects/:id', () => {
	beforeEach(() => vi.clearAllMocks());

	it('updates project fields', async () => {
		const project = { id: 'p-1', name: 'Old Name', slug: 'old-name', branch: 'main' };
		setupSelectChain([project]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ ...project, name: 'New Name' }])
				})
			})
		});

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'p-1' }, body: { name: 'New Name' } })
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.name).toBe('New Name');
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'nope' }, body: { name: 'X' } })
		);

		expect(res.status).toBe(404);
	});
});

describe('DELETE /api/projects/:id', () => {
	beforeEach(() => vi.clearAllMocks());

	it('deletes project and cleans up', async () => {
		const project = { id: 'p-1', slug: 'my-app', domain: 'my-app.example.com' };
		setupSelectChain([project]);

		mockDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		});

		const { DELETE } = await import('./[id]/+server');
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { DELETE } = await import('./[id]/+server');
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

describe('POST /api/projects/:id/deploy', () => {
	beforeEach(() => vi.clearAllMocks());

	it('triggers deployment for valid project', async () => {
		const project = {
			id: 'p-1',
			slug: 'my-app',
			repoUrl: 'https://github.com/user/repo.git',
			branch: 'main',
			port: 3001,
			domain: 'my-app.example.com',
			frameworkId: null,
			tier: null
		};
		setupSelectChain([project]);

		const { POST } = await import('./[id]/deploy/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.deploymentId).toBe('d-1');
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { POST } = await import('./[id]/deploy/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

describe('GET /api/projects/:id/deployments', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns deployment list', async () => {
		const deploys = [
			{ id: 'd-1', status: 'live' },
			{ id: 'd-2', status: 'failed' }
		];

		let callCount = 0;
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockImplementation(() => {
						callCount++;
						return callCount === 1
							? Promise.resolve([{ id: 'p-1' }])
							: Promise.resolve(deploys);
					}),
					orderBy: vi.fn().mockResolvedValue(deploys)
				})
			})
		}));

		const { GET } = await import('./[id]/deployments/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(2);
	});
});

describe('GET /api/projects/:id/deployments/:did', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns deployment with logs', async () => {
		const deployment = { id: 'd-1', status: 'live', projectId: 'p-1' };
		const logs = [{ id: 1, phase: 'clone', message: 'Cloning…' }];

		let callCount = 0;
		mockDb.select.mockImplementation(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockImplementation(() => {
						callCount++;
						return callCount === 1 ? Promise.resolve([deployment]) : Promise.resolve(logs);
					}),
					orderBy: vi.fn().mockResolvedValue(logs)
				})
			})
		}));

		const { GET } = await import('./[id]/deployments/[did]/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe('d-1');
		expect(data.logs).toBeTruthy();
	});

	it('returns 404 for missing deployment', async () => {
		setupSelectChain([]);

		const { GET } = await import('./[id]/deployments/[did]/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'nope' } }));

		expect(res.status).toBe(404);
	});
});
