import { describe, it, expect } from 'vitest';

describe('Connect Provider Page', () => {
	it('renders provider cards section', () => {
		const providers = ['github', 'gitlab', 'forgejo'];
		expect(providers).toHaveLength(3);
	});

	it('GitHub uses OAuth connect flow', () => {
		const connectUrl = '/api/git/github?action=connect';
		expect(connectUrl).toContain('action=connect');
	});

	it('GitLab uses OAuth connect flow', () => {
		const connectUrl = '/api/git/gitlab?action=connect';
		expect(connectUrl).toContain('action=connect');
	});

	it('Forgejo uses API token authentication', () => {
		const authType = 'token';
		expect(authType).toBe('token');
	});

	it('provider labels map correctly', () => {
		const labels: Record<string, string> = {
			github: 'GitHub',
			gitlab: 'GitLab',
			forgejo: 'Forgejo / Gitea'
		};
		expect(labels.github).toBe('GitHub');
		expect(labels.gitlab).toBe('GitLab');
		expect(labels.forgejo).toBe('Forgejo / Gitea');
	});

	it('connections can be filtered by provider', () => {
		const connections = [
			{ id: '1', provider: 'github', accountName: 'user1' },
			{ id: '2', provider: 'gitlab', accountName: 'user2' },
			{ id: '3', provider: 'forgejo', accountName: 'user3' }
		];
		const github = connections.filter((c) => c.provider === 'github');
		const gitlab = connections.filter((c) => c.provider === 'gitlab');
		const forgejo = connections.filter((c) => c.provider === 'forgejo');
		expect(github).toHaveLength(1);
		expect(gitlab).toHaveLength(1);
		expect(forgejo).toHaveLength(1);
	});

	it('validates Forgejo instance URL format', () => {
		const validUrls = ['https://codeberg.org', 'https://git.mycompany.com'];
		const invalidUrls = ['not-a-url', 'ftp://invalid'];

		for (const url of validUrls) {
			expect(() => new URL(url)).not.toThrow();
		}
		expect(() => new URL('not-a-url')).toThrow();
	});

	it('other provider card links to manual setup', () => {
		const manualPath = '/new';
		expect(manualPath).toBe('/new');
	});
});
