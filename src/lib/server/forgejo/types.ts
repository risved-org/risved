export interface ForgejoRepo {
	id: number;
	full_name: string;
	name: string;
	owner: { login: string; avatar_url: string };
	private: boolean;
	default_branch: string;
	html_url: string;
	clone_url: string;
	description: string;
	language: string;
	updated_at: string;
}

export interface ForgejoUser {
	login: string;
	avatar_url: string;
	full_name: string;
}

export interface CommitStatusParams {
	owner: string;
	repo: string;
	sha: string;
	state: 'pending' | 'success' | 'failure' | 'error' | 'warning';
	targetUrl?: string;
	description?: string;
	context?: string;
}

export interface IssueCommentParams {
	owner: string;
	repo: string;
	issueNumber: number;
	body: string;
}

export interface WebhookCreateParams {
	owner: string;
	repo: string;
	webhookUrl: string;
	secret: string;
	events?: string[];
}
