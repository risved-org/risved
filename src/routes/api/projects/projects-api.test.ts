import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}));

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
	envVars: { id: 'id', projectId: 'project_id', key: 'key' },
	domains: { id: 'id', projectId: 'project_id', hostname: 'hostname' },
	previewDeployments: { id: 'id', projectId: 'project_id' }
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
	dockerStop: vi.fn().mockResolvedValue({ success: true }),
	dockerVolumeRemove: vi.fn().mockResolvedValue({ success: true }),
	projectVolumeName: vi.fn((id: string) => `risved-${id}-data`)
}));

vi.mock('$lib/server/preview', () => ({
	cleanupProjectPreviews: vi.fn().mockResolvedValue(0)
}));

vi.mock('$lib/server/caddy', () => ({
	CaddyClient: vi.fn().mockImplementation(() => ({
		removeRoute: vi.fn().mockResolvedValue({ success: true })
	}))
}));

/* Route modules under test — imported statically so module resolution happens
   during collection rather than inside a 5s test timeout */
import * as deployRoute from './[id]/deploy/+server';
import * as deploymentRoute from './[id]/deployments/[did]/+server';
import * as deploymentsRoute from './[id]/deployments/+server';
import * as projectRoute from './[id]/+server';
import * as projectsRoute from './+server';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import { cleanupProjectPreviews } from '$lib/server/preview';
import { previewDeployments } from '$lib/server/db/schema';

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

		const { GET } = projectsRoute;
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

		const { POST } = projectsRoute;
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
		const { POST } = projectsRoute;
		const res = await POST(makeEvent({ method: 'POST', body: { git_url: 'https://x.com/r.git' } }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when git_url is missing', async () => {
		const { POST } = projectsRoute;
		const res = await POST(makeEvent({ method: 'POST', body: { name: 'Test' } }));
		expect(res.status).toBe(400);
	});

	it('returns 409 on duplicate slug', async () => {
		setupSelectChain([{ id: 'p-existing', slug: 'my-app' }]);

		const { POST } = projectsRoute;
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

		const { GET } = projectRoute;
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe('p-1');
		expect(data.latestDeployment).toBeTruthy();
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { GET } = projectRoute;
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

		const { PUT } = projectRoute;
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'p-1' }, body: { name: 'New Name' } })
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.name).toBe('New Name');
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { PUT } = projectRoute;
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'nope' }, body: { name: 'X' } })
		);

		expect(res.status).toBe(404);
	});

	it('returns 400 for invalid JSON body', async () => {
		setupSelectChain([{ id: 'p-1' }]);

		const { PUT } = projectRoute;
		const event = makeEvent({ method: 'PUT', params: { id: 'p-1' } });
		(event as unknown as { request: { json: () => Promise<null> } }).request = {
			json: () => Promise.resolve(null)
		} as never;
		const res = await PUT(event);

		expect(res.status).toBe(400);
	});

	it('returns 400 for empty name string', async () => {
		setupSelectChain([{ id: 'p-1' }]);

		const { PUT } = projectRoute;
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'p-1' }, body: { name: '' } })
		);

		expect(res.status).toBe(400);
	});

	it('returns 400 for empty branch string', async () => {
		setupSelectChain([{ id: 'p-1' }]);

		const { PUT } = projectRoute;
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'p-1' }, body: { branch: '' } })
		);

		expect(res.status).toBe(400);
	});

	it('sets frameworkId to null when framework_id is non-string', async () => {
		const project = { id: 'p-1', slug: 'my-app', branch: 'main', frameworkId: 'sveltekit' };
		setupSelectChain([project]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ ...project, frameworkId: null }])
				})
			})
		});

		const { PUT } = projectRoute;
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'p-1' }, body: { framework_id: 123 } })
		);

		expect(res.status).toBe(200);
	});

	it('sets domain to null when domain value is non-string', async () => {
		const project = { id: 'p-1', slug: 'my-app', branch: 'main', domain: 'example.com' };
		setupSelectChain([project]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ ...project, domain: null }])
				})
			})
		});

		const { PUT } = projectRoute;
		const res = await PUT(
			makeEvent({ method: 'PUT', params: { id: 'p-1' }, body: { domain: 0 } })
		);

		expect(res.status).toBe(200);
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

		const { DELETE } = projectRoute;
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { DELETE } = projectRoute;
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});

	it('deletes project without a domain without touching Caddy', async () => {
		const project = { id: 'p-1', slug: 'no-domain', domain: null };
		setupSelectChain([project]);

		mockDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		});

		const { DELETE } = projectRoute;
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
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

		const { POST } = deployRoute;
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.deploymentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { POST } = deployRoute;
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

		const { GET } = deploymentsRoute;
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

		const { GET } = deploymentRoute;
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe('d-1');
		expect(data.logs).toBeTruthy();
	});

	it('returns 404 for missing deployment', async () => {
		setupSelectChain([]);

		const { GET } = deploymentRoute;
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

describe('DELETE /api/projects/:id image and preview cleanup', () => {
	beforeEach(() => vi.clearAllMocks());

	it('removes the project images and tears down previews before deleting rows', async () => {
		const project = { id: 'p-1', slug: 'my-app', domain: null };
		setupSelectChain([project]);
		mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

		const calls: string[] = [];
		vi.mocked(createCommandRunner).mockReturnValueOnce({
			async exec(cmd: string, args: string[]) {
				const joined = `${cmd} ${args.join(' ')}`;
				calls.push(joined);
				if (joined.startsWith('docker images')) {
					return {
						exitCode: 0,
						stdout: 'my-app:abc1234\nmy-app:abc1234-release\nmy-app-pr-3:def5678\nother-app:abc1234\n',
						stderr: ''
					};
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		} as never);

		const { DELETE } = projectRoute;
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		expect(cleanupProjectPreviews).toHaveBeenCalledWith('p-1');
		expect(calls.filter((c) => c.startsWith('docker rmi')).sort()).toEqual([
			'docker rmi my-app-pr-3:def5678',
			'docker rmi my-app:abc1234',
			'docker rmi my-app:abc1234-release'
		]);
		expect(mockDb.delete).toHaveBeenCalledWith(previewDeployments);
	});
});
