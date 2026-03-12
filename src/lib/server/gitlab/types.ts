export interface GitLabProject {
	id: number;
	path_with_namespace: string;
	name: string;
	namespace: { full_path: string };
	visibility: string;
	default_branch: string;
	web_url: string;
	http_url_to_repo: string;
	description: string | null;
	last_activity_at: string;
}

export interface GitLabUser {
	username: string;
	avatar_url: string;
	name: string;
}

export interface CommitStatusParams {
	projectId: number;
	sha: string;
	state: 'pending' | 'running' | 'success' | 'failed' | 'canceled';
	targetUrl?: string;
	description?: string;
	name?: string;
}

export interface MrNoteParams {
	projectId: number;
	mrIid: number;
	body: string;
}

export interface WebhookCreateParams {
	projectId: number;
	webhookUrl: string;
	secret: string;
	pushEvents?: boolean;
	mergeRequestsEvents?: boolean;
}
