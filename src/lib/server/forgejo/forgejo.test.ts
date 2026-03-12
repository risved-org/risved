import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgejoClient, verifyForgejoToken } from './index';

describe('ForgejoClient', () => {
	let mockFetch: ReturnType<typeof vi.fn>;
	let client: ForgejoClient;

	beforeEach(() => {
		mockFetch = vi.fn();
		client = new ForgejoClient(
			'test-token',
			'https://codeberg.org',
			mockFetch as unknown as typeof fetch
		);
	});

	it('getUser sends correct auth header', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ login: 'testuser', avatar_url: 'url', full_name: 'Test User' })
		});

		const user = await client.getUser();
		expect(user.login).toBe('testuser');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://codeberg.org/api/v1/user',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'token test-token'
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
						html_url: 'https://codeberg.org/user/repo',
						clone_url: 'https://codeberg.org/user/repo.git',
						description: '',
						language: 'Go',
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
			json: () => Promise.resolve({ data: [] })
		});

		await client.searchRepos('my-app');
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/repos/search?q=my-app'),
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
			'https://codeberg.org/api/v1/repos/user/repo/statuses/abc123',
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"state":"success"')
			})
		);
	});

	it('createIssueComment posts comment', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

		await client.createIssueComment({
			owner: 'user',
			repo: 'repo',
			issueNumber: 42,
			body: 'Deploy preview ready'
		});

		expect(mockFetch).toHaveBeenCalledWith(
			'https://codeberg.org/api/v1/repos/user/repo/issues/42/comments',
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
			'https://codeberg.org/api/v1/repos/user/repo/hooks',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('works with self-hosted Gitea instance', async () => {
		const selfHosted = new ForgejoClient(
			'token',
			'https://git.mycompany.com',
			mockFetch as unknown as typeof fetch
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ login: 'me', avatar_url: '', full_name: 'Me' })
		});

		await selfHosted.getUser();
		expect(mockFetch).toHaveBeenCalledWith(
			'https://git.mycompany.com/api/v1/user',
			expect.anything()
		);
	});

	it('throws on non-ok response', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: () => Promise.resolve('Unauthorized')
		});

		await expect(client.getUser()).rejects.toThrow('Forgejo API 401');
	});
});

describe('verifyForgejoToken', () => {
	it('returns user on valid token', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ login: 'codeberg-user', avatar_url: 'url', full_name: 'Coder' })
		});

		const user = await verifyForgejoToken(
			'https://codeberg.org',
			'valid-token',
			mockFetch as unknown as typeof fetch
		);
		expect(user.login).toBe('codeberg-user');
	});

	it('throws on invalid token', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: () => Promise.resolve('Unauthorized')
		});

		await expect(
			verifyForgejoToken('https://codeberg.org', 'bad-token', mockFetch as unknown as typeof fetch)
		).rejects.toThrow('Forgejo API 401');
	});
});
