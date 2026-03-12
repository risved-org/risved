import type {
	GitHubRepo,
	GitHubUser,
	CommitStatusParams,
	PrCommentParams,
	WebhookCreateParams
} from './types';

const GITHUB_API = 'https://api.github.com';

/**
 * GitHub API client. Accepts access token and optional fetch function for testing.
 */
export class GitHubClient {
	constructor(
		private accessToken: string,
		private fetchFn: typeof fetch = fetch
	) {}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
		const res = await this.fetchFn(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.accessToken}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...(options.headers as Record<string, string>)
			}
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
		}

		return res.json() as Promise<T>;
	}

	/** Get authenticated user info. */
	async getUser(): Promise<GitHubUser> {
		return this.request<GitHubUser>('/user');
	}

	/** List repositories accessible to the authenticated user. */
	async listRepos(page = 1, perPage = 30): Promise<GitHubRepo[]> {
		return this.request<GitHubRepo[]>(
			`/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}`
		);
	}

	/** Search repositories by query. */
	async searchRepos(query: string, perPage = 20): Promise<GitHubRepo[]> {
		const result = await this.request<{ items: GitHubRepo[] }>(
			`/search/repositories?q=${encodeURIComponent(query)}+in:name&per_page=${perPage}&sort=updated`
		);
		return result.items;
	}

	/** Post a commit status check. */
	async createCommitStatus(params: CommitStatusParams): Promise<void> {
		await this.request(`/repos/${params.owner}/${params.repo}/statuses/${params.sha}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				state: params.state,
				target_url: params.targetUrl ?? '',
				description: params.description ?? '',
				context: params.context ?? 'risved/deploy'
			})
		});
	}

	/** Post a comment on a pull request. */
	async createPrComment(params: PrCommentParams): Promise<void> {
		await this.request(`/repos/${params.owner}/${params.repo}/issues/${params.prNumber}/comments`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ body: params.body })
		});
	}

	/** Create a webhook on a repository. */
	async createWebhook(params: WebhookCreateParams): Promise<{ id: number }> {
		return this.request<{ id: number }>(`/repos/${params.owner}/${params.repo}/hooks`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: 'web',
				active: true,
				events: params.events ?? ['push', 'pull_request'],
				config: {
					url: params.webhookUrl,
					secret: params.secret,
					content_type: 'json',
					insecure_ssl: '0'
				}
			})
		});
	}

	/** Delete a webhook from a repository. */
	async deleteWebhook(owner: string, repo: string, hookId: number): Promise<void> {
		await this.fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/hooks/${hookId}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${this.accessToken}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
	}
}

/**
 * Build GitHub OAuth authorization URL.
 */
export function getGitHubAuthUrl(clientId: string, redirectUri: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: 'repo',
		state
	});
	return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * Exchange authorization code for access token.
 */
export async function exchangeGitHubCode(
	clientId: string,
	clientSecret: string,
	code: string,
	fetchFn: typeof fetch = fetch
): Promise<{ access_token: string; token_type: string; scope: string }> {
	const res = await fetchFn('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code
		})
	});

	if (!res.ok) {
		throw new Error(`GitHub OAuth token exchange failed: ${res.status}`);
	}

	const data = (await res.json()) as Record<string, string>;
	if (data.error) {
		throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
	}

	return data as unknown as { access_token: string; token_type: string; scope: string };
}
