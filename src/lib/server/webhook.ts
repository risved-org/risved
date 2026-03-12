import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify an HMAC-SHA256 webhook signature.
 * Checks common headers from GitHub, Gitea, Forgejo, and GitLab.
 */
export function verifySignature(
	payload: string,
	secret: string,
	headers: Record<string, string>
): boolean {
	const expected = createHmac('sha256', secret).update(payload).digest('hex');

	/* GitHub: X-Hub-Signature-256 = sha256=<hex> */
	const hubSig = headers['x-hub-signature-256'];
	if (hubSig) {
		const hex = hubSig.startsWith('sha256=') ? hubSig.slice(7) : hubSig;
		return safeCompare(hex, expected);
	}

	/* Gitea / Forgejo: X-Gitea-Signature or X-Forgejo-Signature = <hex> */
	const giteaSig = headers['x-gitea-signature'] || headers['x-forgejo-signature'];
	if (giteaSig) {
		return safeCompare(giteaSig, expected);
	}

	/* GitLab: X-Gitlab-Token = raw secret (not HMAC) */
	const gitlabToken = headers['x-gitlab-token'];
	if (gitlabToken) {
		return safeCompare(gitlabToken, secret);
	}

	return false;
}

/** Timing-safe string comparison. */
function safeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
	} catch {
		return false;
	}
}

/** Parsed webhook event data. */
export interface WebhookEvent {
	type: 'push' | 'pr_merge' | 'pr_open' | 'pr_update' | 'pr_close' | 'unknown';
	branch: string | null;
	commitSha: string | null;
	commitMessage: string | null;
	sender: string | null;
	prNumber: number | null;
	prTitle: string | null;
}

/** Default result for unknown events. */
const UNKNOWN_EVENT: WebhookEvent = {
	type: 'unknown',
	branch: null,
	commitSha: null,
	commitMessage: null,
	sender: null,
	prNumber: null,
	prTitle: null
};

/**
 * Parse a webhook payload into a normalized event structure.
 * Handles GitHub, Gitea, Forgejo, and GitLab push/PR formats.
 */
export function parseWebhookPayload(
	headers: Record<string, string>,
	body: Record<string, unknown>
): WebhookEvent {
	const githubEvent =
		headers['x-github-event'] || headers['x-gitea-event'] || headers['x-forgejo-event'];
	const gitlabEvent = headers['x-gitlab-event'];

	/* GitHub / Gitea / Forgejo push */
	if (githubEvent === 'push') {
		const ref = body.ref as string | undefined;
		const branch = ref?.startsWith('refs/heads/') ? ref.slice(11) : (ref ?? null);
		const headCommit = body.head_commit as Record<string, unknown> | undefined;
		return {
			type: 'push',
			branch,
			commitSha: (body.after as string) ?? (headCommit?.id as string) ?? null,
			commitMessage: (headCommit?.message as string) ?? null,
			sender: ((body.sender as Record<string, unknown>)?.login as string) ?? null,
			prNumber: null,
			prTitle: null
		};
	}

	/* GitHub / Gitea / Forgejo pull request */
	if (githubEvent === 'pull_request') {
		return parseGitHubPrEvent(body);
	}

	/* GitLab push */
	if (gitlabEvent === 'Push Hook') {
		const ref = body.ref as string | undefined;
		const branch = ref?.startsWith('refs/heads/') ? ref.slice(11) : (ref ?? null);
		const commits = body.commits as Record<string, unknown>[] | undefined;
		const lastCommit = commits?.[commits.length - 1];
		return {
			type: 'push',
			branch,
			commitSha: (body.after as string) ?? null,
			commitMessage: (lastCommit?.message as string) ?? null,
			sender: (body.user_username as string) ?? null,
			prNumber: null,
			prTitle: null
		};
	}

	/* GitLab merge request */
	if (gitlabEvent === 'Merge Request Hook') {
		return parseGitLabMrEvent(body);
	}

	return { ...UNKNOWN_EVENT };
}

/**
 * Parse GitHub/Gitea/Forgejo pull_request events into open/update/merge/close.
 */
function parseGitHubPrEvent(body: Record<string, unknown>): WebhookEvent {
	const action = body.action as string;
	const pr = body.pull_request as Record<string, unknown> | undefined;
	const prNumber = (pr?.number as number) ?? null;
	const prTitle = (pr?.title as string) ?? null;
	const head = pr?.head as Record<string, unknown> | undefined;
	const base = pr?.base as Record<string, unknown> | undefined;
	const sender = ((body.sender as Record<string, unknown>)?.login as string) ?? null;

	if (action === 'opened') {
		return {
			type: 'pr_open',
			branch: (head?.ref as string) ?? null,
			commitSha: (head?.sha as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	if (action === 'synchronize') {
		return {
			type: 'pr_update',
			branch: (head?.ref as string) ?? null,
			commitSha: (head?.sha as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	if (action === 'closed') {
		const merged = pr?.merged as boolean;
		if (merged) {
			return {
				type: 'pr_merge',
				branch: (base?.ref as string) ?? null,
				commitSha: (pr?.merge_commit_sha as string) ?? null,
				commitMessage: prTitle,
				sender,
				prNumber,
				prTitle
			};
		}
		return {
			type: 'pr_close',
			branch: (head?.ref as string) ?? null,
			commitSha: (head?.sha as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	return { ...UNKNOWN_EVENT };
}

/**
 * Parse GitLab merge request events into open/update/merge/close.
 */
function parseGitLabMrEvent(body: Record<string, unknown>): WebhookEvent {
	const attrs = body.object_attributes as Record<string, unknown> | undefined;
	const action = attrs?.action as string | undefined;
	const prNumber = (attrs?.iid as number) ?? null;
	const prTitle = (attrs?.title as string) ?? null;
	const sender = ((body.user as Record<string, unknown>)?.username as string) ?? null;
	const sourceBranch = (attrs?.source_branch as string) ?? null;
	const targetBranch = (attrs?.target_branch as string) ?? null;

	if (action === 'open') {
		return {
			type: 'pr_open',
			branch: sourceBranch,
			commitSha: ((attrs?.last_commit as Record<string, unknown>)?.id as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	if (action === 'update') {
		return {
			type: 'pr_update',
			branch: sourceBranch,
			commitSha: ((attrs?.last_commit as Record<string, unknown>)?.id as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	if (action === 'merge') {
		return {
			type: 'pr_merge',
			branch: targetBranch,
			commitSha: (attrs?.merge_commit_sha as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	if (action === 'close') {
		return {
			type: 'pr_close',
			branch: sourceBranch,
			commitSha: ((attrs?.last_commit as Record<string, unknown>)?.id as string) ?? null,
			commitMessage: prTitle,
			sender,
			prNumber,
			prTitle
		};
	}

	return { ...UNKNOWN_EVENT };
}
