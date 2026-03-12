import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient, getGitHubAuthUrl, exchangeGitHubCode } from './index';

describe('GitHubClient', () => {
	let mockFetch: ReturnType<typeof vi.fn>;
	let client: GitHubClient;

	beforeEach(() => {
		mockFetch = vi.fn();
		client = new GitHubClient('test-token', mockFetch as unknown as typeof fetch);
	});

	it('getUser sends correct auth header', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ login: 'testuser', avatar_url: 'url', name: 'Test' })
		});

		const user = await client.getUser();
		expect(user.login).toBe('testuser');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.github.com/user',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer test-token'
				})
			})
		);
	});

	it('listRepos returns repo list', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve([
					{
						id: 1,
						full_name: 'user/repo',
						name: 'repo',
						owner: { login: 'user', avatar_url: '' },
						private: false,
						default_branch: 'main',
						html_url: 'https://github.com/user/repo',
						clone_url: 'https://github.com/user/repo.git',
						description: null,
						language: 'TypeScript',
						updated_at: '2026-03-12T00:00:00Z'
					}
				])
		});

		const repos = await client.listRepos();
		expect(repos).toHaveLength(1);
		expect(repos[0].full_name).toBe('user/repo');
	});

	it('searchRepos calls correct endpoint', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ items: [] })
		});

		await client.searchRepos('my-app');
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/search/repositories?q=my-app'),
			expect.anything()
		);
	});

	it('createCommitStatus posts status', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

		await client.createCommitStatus({
			owner: 'user',
			repo: 'repo',
			sha: 'abc123',
			state: 'success',
			description: 'Deploy succeeded'
		});

		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.github.com/repos/user/repo/statuses/abc123',
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"state":"success"')
			})
		);
	});

	it('createPrComment posts comment', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

		await client.createPrComment({
			owner: 'user',
			repo: 'repo',
			prNumber: 42,
			body: 'Deploy preview: https://preview.example.com'
		});

		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.github.com/repos/user/repo/issues/42/comments',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('createWebhook creates repo webhook', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 999 }) });

		const result = await client.createWebhook({
			owner: 'user',
			repo: 'repo',
			webhookUrl: 'https://risved.example.com/api/webhooks/proj-1',
			secret: 'whsec_123'
		});

		expect(result.id).toBe(999);
		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.github.com/repos/user/repo/hooks',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('throws on non-ok response', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			text: () => Promise.resolve('Not Found')
		});

		await expect(client.getUser()).rejects.toThrow('GitHub API 404');
	});
});

describe('getGitHubAuthUrl', () => {
	it('builds correct OAuth URL', () => {
		const url = getGitHubAuthUrl('client-123', 'https://example.com/callback', 'state-abc');
		expect(url).toContain('github.com/login/oauth/authorize');
		expect(url).toContain('client_id=client-123');
		expect(url).toContain('redirect_uri=');
		expect(url).toContain('state=state-abc');
		expect(url).toContain('scope=repo');
	});
});

describe('exchangeGitHubCode', () => {
	it('exchanges code for token', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					access_token: 'gho_abc123',
					token_type: 'bearer',
					scope: 'repo'
				})
		});

		const result = await exchangeGitHubCode(
			'client-id',
			'client-secret',
			'auth-code',
			mockFetch as unknown as typeof fetch
		);
		expect(result.access_token).toBe('gho_abc123');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://github.com/login/oauth/access_token',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('throws on error response', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					error: 'bad_verification_code',
					error_description: 'The code passed is incorrect'
				})
		});

		await expect(
			exchangeGitHubCode(
				'client-id',
				'client-secret',
				'bad-code',
				mockFetch as unknown as typeof fetch
			)
		).rejects.toThrow('The code passed is incorrect');
	});

	it('throws on non-ok HTTP response', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: false,
			status: 500
		});

		await expect(
			exchangeGitHubCode('client-id', 'client-secret', 'code', mockFetch as unknown as typeof fetch)
		).rejects.toThrow('token exchange failed');
	});
});
