import { describe, it, expect } from 'vitest';
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
