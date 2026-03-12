import type {
	ForgejoRepo,
	ForgejoUser,
	CommitStatusParams,
	IssueCommentParams,
	WebhookCreateParams
} from './types';

/**
 * Forgejo/Gitea API client. Works with any Forgejo or Gitea instance (including Codeberg).
 * Uses API token authentication.
 */
export class ForgejoClient {
	private baseUrl: string;

	constructor(
		private accessToken: string,
		instanceUrl: string,
		private fetchFn: typeof fetch = fetch
	) {
		this.baseUrl = `${instanceUrl.replace(/\/+$/, '')}/api/v1`;
	}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await this.fetchFn(url, {
			...options,
			headers: {
				Authorization: `token ${this.accessToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
				...(options.headers as Record<string, string>)
			}
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`Forgejo API ${res.status}: ${text.slice(0, 200)}`);
		}

		return res.json() as Promise<T>;
	}

	/** Get authenticated user info. */
	async getUser(): Promise<ForgejoUser> {
		return this.request<ForgejoUser>('/user');
	}

	/** List repositories accessible to the authenticated user. */
	async listRepos(page = 1, perPage = 30): Promise<ForgejoRepo[]> {
		return this.request<ForgejoRepo[]>(
			`/user/repos?sort=updated&order=desc&limit=${perPage}&page=${page}`
		);
	}

	/** Search repositories by name. */
	async searchRepos(query: string, perPage = 20): Promise<ForgejoRepo[]> {
		const result = await this.request<{ data: ForgejoRepo[] }>(
			`/repos/search?q=${encodeURIComponent(query)}&limit=${perPage}&sort=updated`
		);
		return result.data;
	}

	/** Post a commit status. */
	async createCommitStatus(params: CommitStatusParams): Promise<void> {
		await this.request(`/repos/${params.owner}/${params.repo}/statuses/${params.sha}`, {
			method: 'POST',
			body: JSON.stringify({
				state: params.state,
				target_url: params.targetUrl ?? '',
				description: params.description ?? '',
				context: params.context ?? 'risved/deploy'
			})
		});
	}

	/** Post a comment on an issue or pull request. */
	async createIssueComment(params: IssueCommentParams): Promise<void> {
		await this.request(
			`/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/comments`,
			{
				method: 'POST',
				body: JSON.stringify({ body: params.body })
			}
		);
	}

	/** Create a webhook on a repository. */
	async createWebhook(params: WebhookCreateParams): Promise<{ id: number }> {
		return this.request<{ id: number }>(`/repos/${params.owner}/${params.repo}/hooks`, {
			method: 'POST',
			body: JSON.stringify({
				type: 'forgejo',
				active: true,
				events: params.events ?? ['push', 'pull_request'],
				config: {
					url: params.webhookUrl,
					secret: params.secret,
					content_type: 'json'
				}
			})
		});
	}

	/** Delete a webhook from a repository. */
	async deleteWebhook(owner: string, repo: string, hookId: number): Promise<void> {
		await this.fetchFn(`${this.baseUrl}/repos/${owner}/${repo}/hooks/${hookId}`, {
			method: 'DELETE',
			headers: {
				Authorization: `token ${this.accessToken}`,
				'Content-Type': 'application/json'
			}
		});
	}
}

/**
 * Verify a Forgejo/Gitea API token by fetching user info.
 * Returns user info if valid, throws if invalid.
 */
export async function verifyForgejoToken(
	instanceUrl: string,
	token: string,
	fetchFn: typeof fetch = fetch
): Promise<ForgejoUser> {
	const client = new ForgejoClient(token, instanceUrl, fetchFn);
	return client.getUser();
}
