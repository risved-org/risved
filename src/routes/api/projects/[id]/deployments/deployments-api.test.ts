import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
};

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			}),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	});
}

vi.mock('$lib/server/db', () => ({ db: mockDb }));

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' },
	deployments: { id: 'id', projectId: 'project_id', status: 'status', isPreview: 'is_preview' },
	buildLogs: { id: 'id', deploymentId: 'deployment_id', timestamp: 'timestamp' }
}));

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockReturnValue({ id: 'user-1', email: 'admin@test.com' }),
	jsonError: vi.fn((status: number, message: string) => {
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	})
}));

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue({ success: true, deploymentId: 'new-dep', logs: [] })
}));

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	dockerStop: vi.fn().mockResolvedValue({ success: true })
}));

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(overrides: {
	method?: string;
	params?: Record<string, string>;
} = {}) {
	const { method = 'GET', params = {} } = overrides;
	return {
		request: new Request('http://localhost/api/projects/p-1/deployments/d-1', { method }),
		locals: { user: { id: 'user-1' }, session: {} },
		params,
		url: new URL('http://localhost/api/projects/p-1/deployments/d-1')
	} as never;
}

/** Serialized SQL of the condition a `.where()` spy was called with. */
function whereClauseOf(spy: ReturnType<typeof vi.fn>): string {
	return JSON.stringify(spy.mock.calls[0]?.[0] ?? null);
}

/** Queue one `.select()` result per call, each resolving through `.limit()`. */
function queueLookups(...results: unknown[][]) {
	for (const rows of results) {
		mockDb.select.mockImplementationOnce(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(rows),
					orderBy: vi.fn().mockResolvedValue(rows)
				})
			})
		}));
	}
}

/* ── Tests: GET deployments list ──────────────────────────────────── */

describe('GET /api/projects/:id/deployments', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns deployment list for a project', async () => {
		const deploymentRows = [
			{ id: 'd-1', projectId: 'p-1', status: 'live', createdAt: '2026-01-01' },
			{ id: 'd-2', projectId: 'p-1', status: 'stopped', createdAt: '2025-12-01' }
		];

		mockDb.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockResolvedValue(deploymentRows)
					})
				})
			}));

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(2);
		expect(data[0].id).toBe('d-1');
	});

	it('excludes PR preview builds from the deployment history', async () => {
		const where = vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) });

		queueLookups([{ id: 'p-1' }]);
		mockDb.select.mockImplementationOnce(() => ({ from: vi.fn().mockReturnValue({ where }) }));

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		expect(whereClauseOf(where)).toContain('is_preview');
	});

	it('returns 404 when project not found', async () => {
		setupSelectChain([]);

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

/* ── Tests: Stop endpoint ─────────────────────────────────────────── */

describe('POST /api/projects/:id/deployments/:did/stop', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stops a running deployment', async () => {
		const deployment = {
			id: 'd-1',
			projectId: 'p-1',
			status: 'live',
			containerName: 'my-app'
		};
		setupSelectChain([deployment]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ ...deployment, status: 'stopped' }])
				})
			})
		});

		const { POST } = await import('./[did]/stop/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.status).toBe('stopped');
	});

	it('returns 404 for missing deployment', async () => {
		setupSelectChain([]);

		const { POST } = await import('./[did]/stop/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'nope' } }));

		expect(res.status).toBe(404);
	});

	it('returns 400 when no container name', async () => {
		setupSelectChain([{ id: 'd-1', status: 'live', containerName: null }]);

		const { POST } = await import('./[did]/stop/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(400);
	});

	it('returns 400 when already stopped', async () => {
		setupSelectChain([{ id: 'd-1', status: 'stopped', containerName: 'my-app' }]);

		const { POST } = await import('./[did]/stop/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(400);
	});
});

/* ── Tests: Rollback endpoint ─────────────────────────────────────── */

describe('POST /api/projects/:id/deployments/:did/rollback', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 404 when project not found', async () => {
		setupSelectChain([]);
		const { POST } = await import('./[did]/rollback/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(404);
	});

	it('refuses to roll back to a PR preview build', async () => {
		queueLookups(
			[{ id: 'p-1', slug: 'my-app', port: 3001, domain: 'my-app.example.com' }],
			[{ id: 'd-1', projectId: 'p-1', status: 'live', imageTag: 'my-app-pr-7:abc', isPreview: true }]
		);

		const { POST } = await import('./[did]/rollback/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('Cannot rollback to a PR preview build');
	});
});

/* ── Tests: Rebuild endpoint ──────────────────────────────────────── */

describe('POST /api/projects/:id/deployments/:did/rebuild', () => {
	beforeEach(() => vi.clearAllMocks());

	it('refuses to rebuild a PR preview build', async () => {
		queueLookups(
			[{ id: 'p-1', slug: 'my-app', port: 3001, repoUrl: 'https://example.com/r.git', branch: 'main' }],
			[{ id: 'd-1', projectId: 'p-1', status: 'live', commitSha: 'abc1234', isPreview: true }]
		);

		const { runPipeline } = await import('$lib/server/pipeline');
		const { POST } = await import('./[did]/rebuild/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('Cannot rebuild a PR preview build');
		expect(runPipeline).not.toHaveBeenCalled();
	});
});

/* ── Tests: Logs SSE endpoint ─────────────────────────────────────── */

describe('GET /api/projects/:id/deployments/:did/logs', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 404 for missing deployment', async () => {
		setupSelectChain([]);

		const { GET } = await import('./[did]/logs/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'nope' } }));

		expect(res.status).toBe(404);
	});

	it('streams logs for a terminal deployment and closes', async () => {
		const deployment = { id: 'd-1', projectId: 'p-1', status: 'live' };
		const logs = [
			{ id: 1, timestamp: '2026-01-01T00:00:00Z', phase: 'clone', level: 'info', message: 'Cloning…' },
			{ id: 2, timestamp: '2026-01-01T00:00:01Z', phase: 'build', level: 'info', message: 'Building…' }
		];

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

		const { GET } = await import('./[did]/logs/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'd-1' } }));

		expect(res.headers.get('Content-Type')).toBe('text/event-stream');

		const text = await res.text();
		expect(text).toContain('data: ');
		expect(text).toContain('Cloning');
		expect(text).toContain('Building');
		expect(text).toContain('event: done');
		expect(text).toContain('live');
	});

	it('streams logs for an in-progress deployment and closes when terminal', async () => {
		/* Select call sequence:
		 * 0 – initial deployment lookup → non-terminal (building)
		 * 1 – in-loop log poll          → one log entry
		 * 2 – in-loop status re-check   → terminal (live) → loop exits
		 */
		let selectCallIdx = 0;
		mockDb.select.mockImplementation(() => {
			const idx = selectCallIdx++;
			return {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockImplementation(() => {
							if (idx === 0) {
								return Promise.resolve([{ id: 'd-2', projectId: 'p-1', status: 'building' }]);
							}
							return Promise.resolve([{ id: 'd-2', projectId: 'p-1', status: 'live' }]);
						}),
						orderBy: vi.fn().mockResolvedValue([
							{ id: 10, timestamp: '2026-01-01T00:00:00Z', phase: 'build', level: 'info', message: 'Compiling' }
						])
					})
				})
			};
		});

		const { GET } = await import('./[did]/logs/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'd-2' } }));

		expect(res.headers.get('Content-Type')).toBe('text/event-stream');
		expect(res.headers.get('Cache-Control')).toBe('no-cache');

		const text = await res.text();
		expect(text).toContain('Compiling');
		expect(text).toContain('event: done');
		expect(text).toContain('live');
	});

	it('stream cancel() sets closed flag without throwing', async () => {
		const deployment = { id: 'd-3', projectId: 'p-1', status: 'building' };
		let selectCallIdx2 = 0;
		mockDb.select.mockImplementation(() => {
			const idx = selectCallIdx2++;
			return {
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockImplementation(() => {
							if (idx === 0) return Promise.resolve([deployment]);
							return Promise.resolve([{ ...deployment, status: 'live' }]);
						}),
						orderBy: vi.fn().mockResolvedValue([])
					})
				})
			};
		});

		const { GET } = await import('./[did]/logs/+server');
		const res = await GET(makeEvent({ params: { id: 'p-1', did: 'd-3' } }));

		await expect(res.body!.cancel()).resolves.toBeUndefined();
	});
});
