import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks — factories must NOT reference file-level variables ── */

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	}
}));
vi.mock('$lib/server/db/schema', () => ({
	previewDeployments: {
		id: 'id', projectId: 'project_id', prNumber: 'pr_number',
		status: 'status', port: 'port', domain: 'domain',
		containerName: 'container_name', deploymentId: 'deployment_id',
		createdAt: 'created_at'
	},
	deployments: { id: 'id', status: 'status', finishedAt: 'finished_at' }
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), asc: vi.fn() }));
vi.mock('$lib/server/settings', () => ({ getSetting: vi.fn() }));
vi.mock('$lib/server/caddy', () => ({
	CaddyClient: vi.fn(),
	createCaddyClient: vi.fn().mockReturnValue({ removeRoute: vi.fn().mockResolvedValue({}) })
}));
vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue({ success: true, deploymentId: 'd-1' })
}));
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() }),
	dockerStop: vi.fn().mockResolvedValue({ success: true })
}));

import { db } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';

/* ── buildPreviewDomain (pure) ──────────────────────────────── */

describe('buildPreviewDomain', () => {
	it('builds domain as pr-{number}.{slug}.{baseDomain}', async () => {
		const { buildPreviewDomain } = await import('./index');
		expect(buildPreviewDomain(42, 'my-app', 'risved.example.com')).toBe(
			'pr-42.my-app.risved.example.com'
		);
	});

	it('handles single-digit PR numbers', async () => {
		const { buildPreviewDomain } = await import('./index');
		expect(buildPreviewDomain(1, 'app', 'test.io')).toBe('pr-1.app.test.io');
	});

	it('handles large PR numbers', async () => {
		const { buildPreviewDomain } = await import('./index');
		expect(buildPreviewDomain(9999, 'project', 'deploy.dev')).toBe('pr-9999.project.deploy.dev');
	});
});

describe('preview types', () => {
	it('module loads successfully', async () => {
		const types = await import('./types');
		expect(types).toBeDefined();
	});
});

/* ── allocatePreviewPort ────────────────────────────────────── */

describe('allocatePreviewPort', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the first available port starting at 4001', async () => {
		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
		} as ReturnType<typeof db.select>);

		const { allocatePreviewPort } = await import('./index');
		const port = await allocatePreviewPort();
		expect(port).toBe(4001);
	});

	it('skips used ports', async () => {
		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ port: 4001 }, { port: 4002 }])
			})
		} as ReturnType<typeof db.select>);

		const { allocatePreviewPort } = await import('./index');
		const port = await allocatePreviewPort();
		expect(port).toBe(4003);
	});
});

/* ── listPreviews ───────────────────────────────────────────── */

describe('listPreviews', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns active previews for a project', async () => {
		const previews = [{ id: 'p-1', status: 'active', projectId: 'proj-1' }];
		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(previews) })
			})
		} as ReturnType<typeof db.select>);

		const { listPreviews } = await import('./index');
		const result = await listPreviews('proj-1');
		expect(result).toEqual(previews);
	});
});

/* ── cleanupPreview ─────────────────────────────────────────── */

describe('cleanupPreview', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stops container, removes caddy route, and marks preview cleaned', async () => {
		const preview = {
			id: 'prev-1', containerName: 'my-app-pr-1',
			domain: 'pr-1.my-app.example.com', deploymentId: 'dep-1', status: 'active'
		};

		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([preview]) })
			})
		} as ReturnType<typeof db.select>);

		vi.mocked(db.update).mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) })
		} as ReturnType<typeof db.update>);

		const { cleanupPreview } = await import('./index');
		await cleanupPreview('prev-1');

		expect(db.update).toHaveBeenCalled();
	});

	it('returns early when preview is not found', async () => {
		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		} as ReturnType<typeof db.select>);

		const { cleanupPreview } = await import('./index');
		await cleanupPreview('unknown-id');

		expect(db.update).not.toHaveBeenCalled();
	});
});

/* ── createPreview ──────────────────────────────────────────── */

const baseProject = {
	id: 'proj-1', slug: 'my-app', repoUrl: 'https://github.com/x/y',
	previewLimit: 5, gitConnectionId: null, frameworkId: null,
	tier: null, buildCommand: null, startCommand: null, releaseCommand: null
};

describe('createPreview', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns error when no hostname is configured', async () => {
		vi.mocked(getSetting).mockResolvedValue(null);

		const { createPreview } = await import('./index');
		const result = await createPreview(baseProject, 1, 'PR title', 'feature/branch', 'abc123');

		expect(result.success).toBe(false);
		expect(result.error).toContain('hostname');
	});

	it('creates a new preview and triggers pipeline', async () => {
		vi.mocked(getSetting).mockResolvedValue('example.com');

		/* .where() must be both directly awaitable (→ []) and chainable (.limit, .orderBy) */
		function makeWhere(rows: unknown[]) {
			const p = Promise.resolve(rows) as Promise<unknown[]> & {
				limit: ReturnType<typeof vi.fn>;
				orderBy: ReturnType<typeof vi.fn>;
			};
			p.limit = vi.fn().mockResolvedValue(rows);
			p.orderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
			return p;
		}

		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockImplementation(() => makeWhere([])),
				orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
			})
		} as ReturnType<typeof db.select>);

		vi.mocked(db.insert).mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: 'prev-1', port: 4001 }])
			})
		} as ReturnType<typeof db.insert>);

		const { createPreview } = await import('./index');
		const result = await createPreview(baseProject, 1, 'PR title', 'feature/branch', 'abc123');

		expect(result.success).toBe(true);
		expect(result.previewId).toBe('prev-1');
	});
});
