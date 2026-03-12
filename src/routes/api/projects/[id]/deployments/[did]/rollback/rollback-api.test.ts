import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockRunRollback = vi.fn();

vi.mock('$lib/server/db', () => {
	const select = vi.fn();
	return { db: { select, insert: vi.fn(), update: vi.fn() } };
});

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' },
	deployments: { id: 'id', projectId: 'project_id', status: 'status' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args)
}));

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockReturnValue({ id: 'user-1', email: 'admin@test.com' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})
	)
}));

vi.mock('$lib/server/pipeline/rollback', () => ({
	runRollback: (...args: unknown[]) => mockRunRollback(...args)
}));

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() })
}));

import { db } from '$lib/server/db';
import { POST } from './+server';

const projectRow = {
	id: 'proj-1',
	slug: 'my-app',
	port: 3001,
	domain: 'my-app.example.com'
};
const deploymentRow = {
	id: 'dep-1',
	projectId: 'proj-1',
	status: 'live',
	imageTag: 'my-app:abc1234',
	commitSha: 'abc1234'
};

let selectCallCount = 0;

function setupSelectChain(rows: unknown[][]) {
	selectCallCount = 0;
	(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
		from: vi.fn().mockImplementation(() => ({
			where: vi.fn().mockImplementation(() => ({
				limit: vi.fn().mockImplementation(() => {
					const result = rows[selectCallCount] ?? [];
					selectCallCount++;
					return Promise.resolve(result);
				})
			}))
		}))
	}));
}

function makeEvent(params: Record<string, string> = {}) {
	return {
		request: new Request('http://localhost/api/projects/proj-1/deployments/dep-1/rollback', {
			method: 'POST'
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', did: 'dep-1', ...params },
		url: new URL('http://localhost/api/projects/proj-1/deployments/dep-1/rollback')
	} as never;
}

describe('POST /api/projects/:id/deployments/:did/rollback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectCallCount = 0;
	});

	it('returns 404 when project not found', async () => {
		setupSelectChain([[]]);
		const res = await POST(makeEvent());
		expect(res.status).toBe(404);
	});

	it('returns 400 when project has no port', async () => {
		setupSelectChain([[{ ...projectRow, port: null }]]);
		const res = await POST(makeEvent());
		expect(res.status).toBe(400);
	});

	it('returns 404 when deployment not found', async () => {
		setupSelectChain([[projectRow], []]);
		const res = await POST(makeEvent());
		expect(res.status).toBe(404);
	});

	it('returns 400 when deployment was not successful', async () => {
		setupSelectChain([[projectRow], [{ ...deploymentRow, status: 'failed' }]]);
		const res = await POST(makeEvent());
		expect(res.status).toBe(400);
	});

	it('returns 400 when deployment has no image tag', async () => {
		setupSelectChain([[projectRow], [{ ...deploymentRow, imageTag: null }]]);
		const res = await POST(makeEvent());
		expect(res.status).toBe(400);
	});

	it('calls runRollback and returns success', async () => {
		setupSelectChain([[projectRow], [deploymentRow]]);
		mockRunRollback.mockResolvedValue({
			success: true,
			deploymentId: 'new-dep-1'
		});

		const res = await POST(makeEvent());
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.deploymentId).toBe('new-dep-1');

		expect(mockRunRollback).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-1',
				projectSlug: 'my-app',
				imageTag: 'my-app:abc1234',
				commitSha: 'abc1234',
				port: 3001,
				domain: 'my-app.example.com'
			}),
			expect.anything()
		);
	});

	it('returns 500 when rollback fails', async () => {
		setupSelectChain([[projectRow], [deploymentRow]]);
		mockRunRollback.mockResolvedValue({
			success: false,
			deploymentId: 'new-dep-1',
			error: 'Health check failed'
		});

		const res = await POST(makeEvent());
		expect(res.status).toBe(500);

		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toBe('Health check failed');
	});

	it('allows rollback to stopped deployment', async () => {
		setupSelectChain([[projectRow], [{ ...deploymentRow, status: 'stopped' }]]);
		mockRunRollback.mockResolvedValue({
			success: true,
			deploymentId: 'new-dep-1'
		});

		const res = await POST(makeEvent());
		expect(res.status).toBe(200);
	});
});
