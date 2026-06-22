import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() }
}));
vi.mock('$lib/server/db/schema', () => ({
	previewDeployments: {}, deployments: {}
}));
vi.mock('$lib/server/caddy', () => ({
	createCaddyClient: vi.fn()
}));
vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn()
}));
vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(), dockerStop: vi.fn()
}));
vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn()
}));

import { buildPreviewDomain } from './index';

describe('buildPreviewDomain', () => {
	it('builds domain as pr-{number}.{slug}.{baseDomain}', () => {
		expect(buildPreviewDomain(42, 'my-app', 'risved.example.com')).toBe(
			'pr-42.my-app.risved.example.com'
		);
	});

	it('handles single-digit PR numbers', () => {
		expect(buildPreviewDomain(1, 'app', 'test.io')).toBe('pr-1.app.test.io');
	});

	it('handles large PR numbers', () => {
		expect(buildPreviewDomain(9999, 'project', 'deploy.dev')).toBe('pr-9999.project.deploy.dev');
	});
});

describe('preview types', () => {
	it('module loads successfully', async () => {
		const types = await import('./types');
		expect(types).toBeDefined();
	});
});
