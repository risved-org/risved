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
	deployments: { id: 'id', projectId: 'project_id', status: 'status' },
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

/* ── Tests: Rollback endpoint (Phase 1 stub) ─────────────────────── */

describe('POST /api/projects/:id/deployments/:did/rollback', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 501 not implemented', async () => {
		const { POST } = await import('./[did]/rollback/+server');
		const res = await POST(makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } }));

		expect(res.status).toBe(501);
		const data = await res.json();
		expect(data.error).toContain('not yet implemented');
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
});
