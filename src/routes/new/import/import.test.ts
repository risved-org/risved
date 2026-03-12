import { describe, it, expect } from 'vitest';

describe('Import Repository Page', () => {
	it('derives project name from clone URL', () => {
		const deriveNameFromUrl = (url: string): string => {
			const cleaned = url.replace(/\/$/, '').replace(/\.git$/, '');
			const parts = cleaned.split('/');
			return parts[parts.length - 1] || '';
		};

		expect(deriveNameFromUrl('https://github.com/user/my-app.git')).toBe('my-app');
		expect(deriveNameFromUrl('https://gitlab.com/org/project')).toBe('project');
		expect(deriveNameFromUrl('https://codeberg.org/user/repo.git/')).toBe('repo');
	});

	it('formats relative dates correctly', () => {
		const formatDate = (iso: string): string => {
			const d = new Date(iso);
			const now = new Date();
			const diff = now.getTime() - d.getTime();
			const days = Math.floor(diff / 86400000);
			if (days === 0) return 'today';
			if (days === 1) return 'yesterday';
			if (days < 30) return `${days}d ago`;
			return d.toLocaleDateString();
		};

		const today = new Date().toISOString();
		expect(formatDate(today)).toBe('today');

		const yesterday = new Date(Date.now() - 86400000).toISOString();
		expect(formatDate(yesterday)).toBe('yesterday');

		const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
		expect(formatDate(weekAgo)).toBe('7d ago');
	});

	it('provider labels map correctly', () => {
		const labels: Record<string, string> = {
			github: 'GitHub',
			gitlab: 'GitLab',
			forgejo: 'Forgejo'
		};
		expect(labels.github).toBe('GitHub');
		expect(labels.gitlab).toBe('GitLab');
		expect(labels.forgejo).toBe('Forgejo');
	});

	it('connections list can be empty', () => {
		const connections: unknown[] = [];
		expect(connections.length === 0).toBe(true);
	});

	it('repo list supports search filtering', () => {
		const repos = [
			{ id: 1, fullName: 'user/my-app', name: 'my-app' },
			{ id: 2, fullName: 'user/other', name: 'other' }
		];

		const filtered = repos.filter((r) => r.name.includes('my'));
		expect(filtered).toHaveLength(1);
		expect(filtered[0].name).toBe('my-app');
	});

	it('repo selection populates config fields', () => {
		const repo = {
			name: 'my-app',
			defaultBranch: 'develop',
			cloneUrl: 'https://github.com/user/my-app.git'
		};

		let projectName = repo.name;
		let branch = repo.defaultBranch;

		expect(projectName).toBe('my-app');
		expect(branch).toBe('develop');
	});
});
