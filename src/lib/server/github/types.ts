export interface GitHubRepo {
	id: number;
	full_name: string;
	name: string;
	owner: { login: string; avatar_url: string };
	private: boolean;
	default_branch: string;
	html_url: string;
	clone_url: string;
	description: string | null;
	language: string | null;
	updated_at: string;
}

export interface GitHubUser {
	login: string;
	avatar_url: string;
	name: string | null;
}

export interface CommitStatusParams {
	owner: string;
	repo: string;
	sha: string;
	state: 'pending' | 'success' | 'failure' | 'error';
	targetUrl?: string;
	description?: string;
	context?: string;
}

export interface PrCommentParams {
	owner: string;
	repo: string;
	prNumber: number;
	body: string;
}

export interface WebhookCreateParams {
	owner: string;
	repo: string;
	webhookUrl: string;
	secret: string;
	events?: string[];
}
