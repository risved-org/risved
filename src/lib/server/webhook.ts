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
	type: 'push' | 'pr_merge' | 'unknown';
	branch: string | null;
	commitSha: string | null;
	commitMessage: string | null;
	sender: string | null;
}

/**
 * Parse a webhook payload into a normalized event structure.
 * Handles GitHub, Gitea, Forgejo, and GitLab push/PR formats.
 */
export function parseWebhookPayload(
	headers: Record<string, string>,
	body: Record<string, unknown>
): WebhookEvent {
	const githubEvent = headers['x-github-event'] || headers['x-gitea-event'] || headers['x-forgejo-event'];
	const gitlabEvent = headers['x-gitlab-event'];

	/* GitHub / Gitea / Forgejo push */
	if (githubEvent === 'push') {
		const ref = body.ref as string | undefined;
		const branch = ref?.startsWith('refs/heads/') ? ref.slice(11) : ref ?? null;
		const headCommit = body.head_commit as Record<string, unknown> | undefined;
		return {
			type: 'push',
			branch,
			commitSha: (body.after as string) ?? headCommit?.id as string ?? null,
			commitMessage: (headCommit?.message as string) ?? null,
			sender: (body.sender as Record<string, unknown>)?.login as string ?? null
		};
	}

	/* GitHub / Gitea / Forgejo pull request merge */
	if (githubEvent === 'pull_request') {
		const action = body.action as string;
		const pr = body.pull_request as Record<string, unknown> | undefined;
		const merged = pr?.merged as boolean;
		if (action === 'closed' && merged) {
			const base = pr?.base as Record<string, unknown> | undefined;
			return {
				type: 'pr_merge',
				branch: (base?.ref as string) ?? null,
				commitSha: (pr?.merge_commit_sha as string) ?? null,
				commitMessage: (pr?.title as string) ?? null,
				sender: (body.sender as Record<string, unknown>)?.login as string ?? null
			};
		}
	}

	/* GitLab push */
	if (gitlabEvent === 'Push Hook') {
		const ref = body.ref as string | undefined;
		const branch = ref?.startsWith('refs/heads/') ? ref.slice(11) : ref ?? null;
		const commits = body.commits as Record<string, unknown>[] | undefined;
		const lastCommit = commits?.[commits.length - 1];
		return {
			type: 'push',
			branch,
			commitSha: (body.after as string) ?? null,
			commitMessage: (lastCommit?.message as string) ?? null,
			sender: (body.user_username as string) ?? null
		};
	}

	/* GitLab merge request */
	if (gitlabEvent === 'Merge Request Hook') {
		const attrs = body.object_attributes as Record<string, unknown> | undefined;
		if (attrs?.action === 'merge') {
			return {
				type: 'pr_merge',
				branch: (attrs?.target_branch as string) ?? null,
				commitSha: (attrs?.merge_commit_sha as string) ?? null,
				commitMessage: (attrs?.title as string) ?? null,
				sender: (body.user as Record<string, unknown>)?.username as string ?? null
			};
		}
	}

	return { type: 'unknown', branch: null, commitSha: null, commitMessage: null, sender: null };
}
