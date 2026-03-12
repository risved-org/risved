import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature, parseWebhookPayload } from './webhook';

describe('verifySignature', () => {
	const secret = 'test-secret';
	const payload = '{"ref":"refs/heads/main"}';

	function hmac(data: string, key: string): string {
		return createHmac('sha256', key).update(data).digest('hex');
	}

	it('verifies GitHub X-Hub-Signature-256', () => {
		const sig = `sha256=${hmac(payload, secret)}`;
		expect(verifySignature(payload, secret, { 'x-hub-signature-256': sig })).toBe(true);
	});

	it('verifies Gitea X-Gitea-Signature', () => {
		const sig = hmac(payload, secret);
		expect(verifySignature(payload, secret, { 'x-gitea-signature': sig })).toBe(true);
	});

	it('verifies Forgejo X-Forgejo-Signature', () => {
		const sig = hmac(payload, secret);
		expect(verifySignature(payload, secret, { 'x-forgejo-signature': sig })).toBe(true);
	});

	it('verifies GitLab X-Gitlab-Token', () => {
		expect(verifySignature(payload, secret, { 'x-gitlab-token': secret })).toBe(true);
	});

	it('rejects invalid signature', () => {
		expect(verifySignature(payload, secret, { 'x-hub-signature-256': 'sha256=bad' })).toBe(false);
	});

	it('rejects when no signature header present', () => {
		expect(verifySignature(payload, secret, {})).toBe(false);
	});

	it('rejects wrong secret', () => {
		const sig = `sha256=${hmac(payload, 'wrong-secret')}`;
		expect(verifySignature(payload, secret, { 'x-hub-signature-256': sig })).toBe(false);
	});
});

describe('parseWebhookPayload', () => {
	it('parses GitHub push event', () => {
		const result = parseWebhookPayload(
			{ 'x-github-event': 'push' },
			{
				ref: 'refs/heads/main',
				after: 'abc1234',
				head_commit: { id: 'abc1234', message: 'fix bug' },
				sender: { login: 'octocat' }
			}
		);

		expect(result.type).toBe('push');
		expect(result.branch).toBe('main');
		expect(result.commitSha).toBe('abc1234');
		expect(result.commitMessage).toBe('fix bug');
		expect(result.sender).toBe('octocat');
	});

	it('parses GitHub PR merge event', () => {
		const result = parseWebhookPayload(
			{ 'x-github-event': 'pull_request' },
			{
				action: 'closed',
				pull_request: {
					number: 7,
					merged: true,
					base: { ref: 'main' },
					head: { ref: 'feat', sha: 'xxx' },
					merge_commit_sha: 'def5678',
					title: 'Add feature'
				},
				sender: { login: 'dev' }
			}
		);

		expect(result.type).toBe('pr_merge');
		expect(result.branch).toBe('main');
		expect(result.commitSha).toBe('def5678');
		expect(result.prNumber).toBe(7);
		expect(result.prTitle).toBe('Add feature');
	});

	it('parses GitHub PR close (not merged) as pr_close', () => {
		const result = parseWebhookPayload(
			{ 'x-github-event': 'pull_request' },
			{
				action: 'closed',
				pull_request: { merged: false, number: 5, title: 'WIP', head: { ref: 'feat', sha: 'a1' } },
				sender: { login: 'dev' }
			}
		);

		expect(result.type).toBe('pr_close');
		expect(result.prNumber).toBe(5);
		expect(result.branch).toBe('feat');
	});

	it('parses GitHub PR open event', () => {
		const result = parseWebhookPayload(
			{ 'x-github-event': 'pull_request' },
			{
				action: 'opened',
				pull_request: {
					number: 42,
					title: 'Add feature',
					head: { ref: 'feat-branch', sha: 'abc123' },
					base: { ref: 'main' }
				},
				sender: { login: 'dev' }
			}
		);

		expect(result.type).toBe('pr_open');
		expect(result.prNumber).toBe(42);
		expect(result.prTitle).toBe('Add feature');
		expect(result.branch).toBe('feat-branch');
		expect(result.commitSha).toBe('abc123');
	});

	it('parses GitHub PR synchronize as pr_update', () => {
		const result = parseWebhookPayload(
			{ 'x-github-event': 'pull_request' },
			{
				action: 'synchronize',
				pull_request: {
					number: 42,
					title: 'Add feature',
					head: { ref: 'feat-branch', sha: 'def456' }
				},
				sender: { login: 'dev' }
			}
		);

		expect(result.type).toBe('pr_update');
		expect(result.prNumber).toBe(42);
		expect(result.commitSha).toBe('def456');
	});

	it('parses GitLab MR open event', () => {
		const result = parseWebhookPayload(
			{ 'x-gitlab-event': 'Merge Request Hook' },
			{
				object_attributes: {
					action: 'open',
					iid: 10,
					title: 'New MR',
					source_branch: 'feature',
					target_branch: 'main',
					last_commit: { id: 'gl123' }
				},
				user: { username: 'gl-dev' }
			}
		);

		expect(result.type).toBe('pr_open');
		expect(result.prNumber).toBe(10);
		expect(result.branch).toBe('feature');
	});

	it('parses GitLab MR update event', () => {
		const result = parseWebhookPayload(
			{ 'x-gitlab-event': 'Merge Request Hook' },
			{
				object_attributes: {
					action: 'update',
					iid: 10,
					title: 'Updated MR',
					source_branch: 'feature',
					target_branch: 'main',
					last_commit: { id: 'gl456' }
				},
				user: { username: 'gl-dev' }
			}
		);

		expect(result.type).toBe('pr_update');
		expect(result.prNumber).toBe(10);
		expect(result.commitSha).toBe('gl456');
	});

	it('parses GitLab MR close event', () => {
		const result = parseWebhookPayload(
			{ 'x-gitlab-event': 'Merge Request Hook' },
			{
				object_attributes: {
					action: 'close',
					iid: 10,
					title: 'Closed MR',
					source_branch: 'feature',
					target_branch: 'main',
					last_commit: { id: 'gl789' }
				},
				user: { username: 'gl-dev' }
			}
		);

		expect(result.type).toBe('pr_close');
		expect(result.prNumber).toBe(10);
	});

	it('parses GitLab push event', () => {
		const result = parseWebhookPayload(
			{ 'x-gitlab-event': 'Push Hook' },
			{
				ref: 'refs/heads/develop',
				after: 'ghi9012',
				user_username: 'gitlab-user',
				commits: [{ message: 'first' }, { message: 'second commit' }]
			}
		);

		expect(result.type).toBe('push');
		expect(result.branch).toBe('develop');
		expect(result.commitSha).toBe('ghi9012');
		expect(result.commitMessage).toBe('second commit');
		expect(result.sender).toBe('gitlab-user');
	});

	it('parses GitLab merge request event', () => {
		const result = parseWebhookPayload(
			{ 'x-gitlab-event': 'Merge Request Hook' },
			{
				object_attributes: {
					action: 'merge',
					target_branch: 'main',
					merge_commit_sha: 'jkl3456',
					title: 'MR title'
				},
				user: { username: 'gl-dev' }
			}
		);

		expect(result.type).toBe('pr_merge');
		expect(result.branch).toBe('main');
		expect(result.sender).toBe('gl-dev');
	});

	it('parses Gitea push event', () => {
		const result = parseWebhookPayload(
			{ 'x-gitea-event': 'push' },
			{
				ref: 'refs/heads/main',
				after: 'xyz789',
				head_commit: { id: 'xyz789', message: 'update' },
				sender: { login: 'gitea-user' }
			}
		);

		expect(result.type).toBe('push');
		expect(result.branch).toBe('main');
	});

	it('returns unknown for unsupported events', () => {
		const result = parseWebhookPayload({ 'x-github-event': 'issues' }, { action: 'opened' });

		expect(result.type).toBe('unknown');
	});
});
