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
					merged: true,
					base: { ref: 'main' },
					merge_commit_sha: 'def5678',
					title: 'Add feature'
				},
				sender: { login: 'dev' }
			}
		);

		expect(result.type).toBe('pr_merge');
		expect(result.branch).toBe('main');
		expect(result.commitSha).toBe('def5678');
	});

	it('returns unknown for non-merge PR close', () => {
		const result = parseWebhookPayload(
			{ 'x-github-event': 'pull_request' },
			{ action: 'closed', pull_request: { merged: false } }
		);

		expect(result.type).toBe('unknown');
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
		const result = parseWebhookPayload(
			{ 'x-github-event': 'issues' },
			{ action: 'opened' }
		);

		expect(result.type).toBe('unknown');
	});
});
