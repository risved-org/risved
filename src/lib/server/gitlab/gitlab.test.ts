import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabClient, getGitLabAuthUrl, exchangeGitLabCode } from './index';

describe('GitLabClient', () => {
	let mockFetch: ReturnType<typeof vi.fn>;
	let client: GitLabClient;

	beforeEach(() => {
		mockFetch = vi.fn();
		client = new GitLabClient(
			'test-token',
			'https://gitlab.com',
			mockFetch as unknown as typeof fetch
		);
	});

	it('getUser sends correct auth header', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ username: 'testuser', avatar_url: 'url', name: 'Test' })
		});

		const user = await client.getUser();
		expect(user.username).toBe('testuser');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://gitlab.com/api/v4/user',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer test-token'
				})
			})
		);
	});

	it('listProjects returns project list', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve([
					{
						id: 1,
						path_with_namespace: 'user/repo',
						name: 'repo',
						namespace: { full_path: 'user' },
						visibility: 'private',
						default_branch: 'main',
						web_url: 'https://gitlab.com/user/repo',
						http_url_to_repo: 'https://gitlab.com/user/repo.git',
						description: null,
						last_activity_at: '2026-03-12T00:00:00Z'
					}
				])
		});

		const projects = await client.listProjects();
		expect(projects).toHaveLength(1);
		expect(projects[0].path_with_namespace).toBe('user/repo');
	});

	it('searchProjects calls correct endpoint', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve([])
		});

		await client.searchProjects('my-app');
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/projects?search=my-app'),
			expect.anything()
		);
	});

	it('createCommitStatus posts status', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

		await client.createCommitStatus({
			projectId: 42,
			sha: 'abc123',
			state: 'success',
			description: 'Deploy succeeded'
		});

		expect(mockFetch).toHaveBeenCalledWith(
			'https://gitlab.com/api/v4/projects/42/statuses/abc123',
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"state":"success"')
			})
		);
	});

	it('createMrNote posts comment', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

		await client.createMrNote({
			projectId: 42,
			mrIid: 7,
			body: 'Deploy preview: https://preview.example.com'
		});

		expect(mockFetch).toHaveBeenCalledWith(
			'https://gitlab.com/api/v4/projects/42/merge_requests/7/notes',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('createWebhook creates project webhook', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 999 }) });

		const result = await client.createWebhook({
			projectId: 42,
			webhookUrl: 'https://risved.example.com/api/webhooks/proj-1',
			secret: 'whsec_123'
		});

		expect(result.id).toBe(999);
		expect(mockFetch).toHaveBeenCalledWith(
			'https://gitlab.com/api/v4/projects/42/hooks',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('supports self-hosted instance URL', async () => {
		const selfHosted = new GitLabClient(
			'token',
			'https://git.mycompany.com',
			mockFetch as unknown as typeof fetch
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ username: 'me', avatar_url: '', name: 'Me' })
		});

		await selfHosted.getUser();
		expect(mockFetch).toHaveBeenCalledWith(
			'https://git.mycompany.com/api/v4/user',
			expect.anything()
		);
	});

	it('throws on non-ok response', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			text: () => Promise.resolve('Not Found')
		});

		await expect(client.getUser()).rejects.toThrow('GitLab API 404');
	});
});

describe('getGitLabAuthUrl', () => {
	it('builds correct OAuth URL for cloud', () => {
		const url = getGitLabAuthUrl('client-123', 'https://example.com/callback', 'state-abc');
		expect(url).toContain('gitlab.com/oauth/authorize');
		expect(url).toContain('client_id=client-123');
		expect(url).toContain('redirect_uri=');
		expect(url).toContain('state=state-abc');
		expect(url).toContain('scope=api+read_user');
		expect(url).toContain('response_type=code');
	});

	it('builds correct OAuth URL for self-hosted', () => {
		const url = getGitLabAuthUrl(
			'client-123',
			'https://example.com/callback',
			'state-abc',
			'https://git.mycompany.com'
		);
		expect(url).toContain('git.mycompany.com/oauth/authorize');
	});
});

describe('exchangeGitLabCode', () => {
	it('exchanges code for token', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					access_token: 'glpat-abc123',
					token_type: 'bearer',
					refresh_token: 'glrt-xyz',
					expires_in: 7200
				})
		});

		const result = await exchangeGitLabCode(
			'client-id',
			'client-secret',
			'auth-code',
			'https://example.com/callback',
			'https://gitlab.com',
			mockFetch as unknown as typeof fetch
		);
		expect(result.access_token).toBe('glpat-abc123');
		expect(result.refresh_token).toBe('glrt-xyz');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://gitlab.com/oauth/token',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('throws on error response', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					error: 'invalid_grant',
					error_description: 'The provided authorization grant is invalid'
				})
		});

		await expect(
			exchangeGitLabCode(
				'client-id',
				'client-secret',
				'bad-code',
				'https://example.com/callback',
				'https://gitlab.com',
				mockFetch as unknown as typeof fetch
			)
		).rejects.toThrow('The provided authorization grant is invalid');
	});

	it('throws on non-ok HTTP response', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: false,
			status: 500
		});

		await expect(
			exchangeGitLabCode(
				'client-id',
				'client-secret',
				'code',
				'https://example.com/callback',
				'https://gitlab.com',
				mockFetch as unknown as typeof fetch
			)
		).rejects.toThrow('token exchange failed');
	});
});
