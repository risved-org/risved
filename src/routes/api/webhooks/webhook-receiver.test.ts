import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn()
};

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	});
}

vi.mock('$lib/server/db', () => ({ db: mockDb }));

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', webhookSecret: 'webhook_secret' },
	webhookDeliveries: {}
}));

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue({ success: true, deploymentId: 'd-1' })
}));

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() })
}));

vi.mock('$lib/server/preview', () => ({
	createPreview: vi.fn().mockResolvedValue({ success: true, previewId: 'pv-1' }),
	cleanupPrPreviews: vi.fn().mockResolvedValue(1)
}));

/* ── Helpers ──────────────────────────────────────────────────────── */

const SECRET = 'webhook-secret-123';

function hmac(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('hex');
}

function makeProject(overrides?: Record<string, unknown>) {
	return {
		id: 'p-1',
		slug: 'my-app',
		repoUrl: 'https://github.com/user/repo.git',
		branch: 'main',
		port: 3001,
		domain: 'my-app.example.com',
		webhookSecret: SECRET,
		frameworkId: null,
		tier: null,
		previewsEnabled: false,
		previewLimit: 3,
		previewAutoDelete: true,
		...overrides
	};
}

function makeEvent(payload: Record<string, unknown>, headers: Record<string, string>) {
	const body = JSON.stringify(payload);
	const reqHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });

	return {
		request: new Request('http://localhost/api/webhooks/p-1', {
			method: 'POST',
			headers: reqHeaders,
			body
		}),
		params: { projectId: 'p-1' },
		locals: {},
		url: new URL('http://localhost/api/webhooks/p-1')
	} as never;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('POST /api/webhooks/:projectId', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDb.insert.mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined)
		});
	});

	it('accepts valid GitHub push and triggers deployment', async () => {
		setupSelectChain([makeProject()]);

		const payload = JSON.stringify({
			ref: 'refs/heads/main',
			after: 'abc1234',
			head_commit: { id: 'abc1234', message: 'deploy me' },
			sender: { login: 'user' }
		});

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-github-event': 'push',
				'x-hub-signature-256': `sha256=${hmac(payload, SECRET)}`
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toBe('triggered deployment');
		expect(data.event).toBe('push');
	});

	it('rejects invalid signature', async () => {
		setupSelectChain([makeProject()]);

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(
				{ ref: 'refs/heads/main' },
				{
					'x-github-event': 'push',
					'x-hub-signature-256': 'sha256=invalid'
				}
			)
		);

		expect(res.status).toBe(401);
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(makeEvent({}, { 'x-github-event': 'push' }));

		expect(res.status).toBe(404);
	});

	it('skips push to non-deploy branch', async () => {
		setupSelectChain([makeProject({ branch: 'main' })]);

		const payload = JSON.stringify({
			ref: 'refs/heads/develop',
			after: 'abc',
			sender: { login: 'user' }
		});

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-github-event': 'push',
				'x-hub-signature-256': `sha256=${hmac(payload, SECRET)}`
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toContain('skipped');
	});

	it('skips unsupported event types', async () => {
		setupSelectChain([makeProject()]);

		const payload = JSON.stringify({ action: 'opened' });

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-github-event': 'issues',
				'x-hub-signature-256': `sha256=${hmac(payload, SECRET)}`
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toContain('unsupported');
	});

	it('triggers preview on PR open when previews enabled', async () => {
		setupSelectChain([makeProject({ previewsEnabled: true })]);

		const payload = JSON.stringify({
			action: 'opened',
			pull_request: {
				number: 42,
				title: 'New feature',
				head: { ref: 'feat-branch', sha: 'sha1' },
				base: { ref: 'main' }
			},
			sender: { login: 'dev' }
		});

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-github-event': 'pull_request',
				'x-hub-signature-256': `sha256=${hmac(payload, SECRET)}`
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toContain('triggered preview');
		expect(data.event).toBe('pr_open');
	});

	it('skips preview on PR open when previews disabled', async () => {
		setupSelectChain([makeProject({ previewsEnabled: false })]);

		const payload = JSON.stringify({
			action: 'opened',
			pull_request: {
				number: 42,
				title: 'New feature',
				head: { ref: 'feat-branch', sha: 'sha1' },
				base: { ref: 'main' }
			},
			sender: { login: 'dev' }
		});

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-github-event': 'pull_request',
				'x-hub-signature-256': `sha256=${hmac(payload, SECRET)}`
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toContain('previews disabled');
	});

	it('cleans up preview on PR close when auto-delete enabled', async () => {
		setupSelectChain([makeProject({ previewsEnabled: true, previewAutoDelete: true })]);

		const payload = JSON.stringify({
			action: 'closed',
			pull_request: {
				number: 42,
				merged: false,
				title: 'Closed PR',
				head: { ref: 'feat', sha: 'sha2' }
			},
			sender: { login: 'dev' }
		});

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-github-event': 'pull_request',
				'x-hub-signature-256': `sha256=${hmac(payload, SECRET)}`
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toContain('cleaning up preview');
	});

	it('accepts Gitea push with valid signature', async () => {
		setupSelectChain([makeProject()]);

		const payload = JSON.stringify({
			ref: 'refs/heads/main',
			after: 'def456',
			head_commit: { id: 'def456', message: 'feat' },
			sender: { login: 'gitea-user' }
		});

		const { POST } = await import('./[projectId]/+server');
		const res = await POST(
			makeEvent(JSON.parse(payload), {
				'x-gitea-event': 'push',
				'x-gitea-signature': hmac(payload, SECRET)
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.action).toBe('triggered deployment');
	});
});
