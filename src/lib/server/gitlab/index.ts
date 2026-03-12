import type {
	GitLabProject,
	GitLabUser,
	CommitStatusParams,
	MrNoteParams,
	WebhookCreateParams
} from './types';

const DEFAULT_INSTANCE = 'https://gitlab.com';

/**
 * GitLab API client. Supports both cloud and self-hosted instances.
 */
export class GitLabClient {
	private baseUrl: string;

	constructor(
		private accessToken: string,
		instanceUrl: string = DEFAULT_INSTANCE,
		private fetchFn: typeof fetch = fetch
	) {
		this.baseUrl = `${instanceUrl.replace(/\/+$/, '')}/api/v4`;
	}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await this.fetchFn(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.accessToken}`,
				'Content-Type': 'application/json',
				...(options.headers as Record<string, string>)
			}
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`GitLab API ${res.status}: ${text.slice(0, 200)}`);
		}

		return res.json() as Promise<T>;
	}

	/** Get authenticated user info. */
	async getUser(): Promise<GitLabUser> {
		return this.request<GitLabUser>('/user');
	}

	/** List projects accessible to the authenticated user. */
	async listProjects(page = 1, perPage = 30): Promise<GitLabProject[]> {
		return this.request<GitLabProject[]>(
			`/projects?membership=true&order_by=updated_at&sort=desc&per_page=${perPage}&page=${page}`
		);
	}

	/** Search projects by name. */
	async searchProjects(query: string, perPage = 20): Promise<GitLabProject[]> {
		return this.request<GitLabProject[]>(
			`/projects?search=${encodeURIComponent(query)}&membership=true&order_by=updated_at&per_page=${perPage}`
		);
	}

	/** Post an external commit status. */
	async createCommitStatus(params: CommitStatusParams): Promise<void> {
		await this.request(`/projects/${params.projectId}/statuses/${params.sha}`, {
			method: 'POST',
			body: JSON.stringify({
				state: params.state,
				target_url: params.targetUrl ?? '',
				description: params.description ?? '',
				name: params.name ?? 'risved/deploy'
			})
		});
	}

	/** Post a note (comment) on a merge request. */
	async createMrNote(params: MrNoteParams): Promise<void> {
		await this.request(`/projects/${params.projectId}/merge_requests/${params.mrIid}/notes`, {
			method: 'POST',
			body: JSON.stringify({ body: params.body })
		});
	}

	/** Create a webhook on a project. */
	async createWebhook(params: WebhookCreateParams): Promise<{ id: number }> {
		return this.request<{ id: number }>(`/projects/${params.projectId}/hooks`, {
			method: 'POST',
			body: JSON.stringify({
				url: params.webhookUrl,
				token: params.secret,
				push_events: params.pushEvents ?? true,
				merge_requests_events: params.mergeRequestsEvents ?? true,
				enable_ssl_verification: true
			})
		});
	}

	/** Delete a webhook from a project. */
	async deleteWebhook(projectId: number, hookId: number): Promise<void> {
		await this.fetchFn(`${this.baseUrl}/projects/${projectId}/hooks/${hookId}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${this.accessToken}`,
				'Content-Type': 'application/json'
			}
		});
	}
}

/**
 * Build GitLab OAuth authorization URL.
 * Supports self-hosted instances via instanceUrl parameter.
 */
export function getGitLabAuthUrl(
	clientId: string,
	redirectUri: string,
	state: string,
	instanceUrl: string = DEFAULT_INSTANCE
): string {
	const base = instanceUrl.replace(/\/+$/, '');
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'api read_user',
		state
	});
	return `${base}/oauth/authorize?${params}`;
}

/**
 * Exchange authorization code for access token.
 * Supports self-hosted instances via instanceUrl parameter.
 */
export async function exchangeGitLabCode(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string,
	instanceUrl: string = DEFAULT_INSTANCE,
	fetchFn: typeof fetch = fetch
): Promise<{
	access_token: string;
	token_type: string;
	refresh_token: string;
	expires_in: number;
}> {
	const base = instanceUrl.replace(/\/+$/, '');
	const res = await fetchFn(`${base}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri
		})
	});

	if (!res.ok) {
		throw new Error(`GitLab OAuth token exchange failed: ${res.status}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	if (data.error) {
		throw new Error(
			`GitLab OAuth error: ${(data.error_description as string) ?? (data.error as string)}`
		);
	}

	return data as unknown as {
		access_token: string;
		token_type: string;
		refresh_token: string;
		expires_in: number;
	};
}
