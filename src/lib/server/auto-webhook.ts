import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { safeDecrypt } from '$lib/server/crypto'
import { GitHubClient } from '$lib/server/github'

/**
 * Parse owner and repo name from a GitHub URL.
 * Handles both https://github.com/owner/repo and https://github.com/owner/repo.git
 */
function parseGitHubOwnerRepo(repoUrl: string): { owner: string, repo: string } | null {
	try {
		const url = new URL(repoUrl)
		if (!url.hostname.includes('github.com')) return null
		const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
		if (parts.length < 2) return null
		return { owner: parts[0], repo: parts[1] }
	} catch {
		return null
	}
}

/**
 * Auto-register a webhook on the Git provider after project creation.
 * Fire-and-forget — errors are logged but don't block the user.
 */
export async function registerWebhook(opts: {
	connectionId: string
	repoUrl: string
	projectId: string
	webhookSecret: string
	origin: string
}): Promise<void> {
	try {
		const [conn] = await db
			.select({ accessToken: gitConnections.accessToken, provider: gitConnections.provider })
			.from(gitConnections)
			.where(eq(gitConnections.id, opts.connectionId))
			.limit(1)

		if (!conn) return

		const token = safeDecrypt(conn.accessToken)
		const webhookUrl = `${opts.origin}/api/webhooks/${opts.projectId}`

		if (conn.provider === 'github') {
			const parsed = parseGitHubOwnerRepo(opts.repoUrl)
			if (!parsed) return

			const client = new GitHubClient(token)
			await client.createWebhook({
				owner: parsed.owner,
				repo: parsed.repo,
				webhookUrl,
				secret: opts.webhookSecret,
				events: ['push', 'pull_request']
			})
		}
		/* GitLab and Forgejo can be added here later */
	} catch (err) {
		console.error('[auto-webhook] Failed to register webhook:', err instanceof Error ? err.message : err)
	}
}

export type RepairResult =
	| { ok: true; action: 'created' | 'updated' }
	| { ok: false; reason: string }

/**
 * Repair a project's webhook on the Git provider.
 *
 * Used when pushes have stopped triggering deployments — typically because the
 * webhook was deleted, disabled, or points at a stale URL/secret. Unlike
 * registerWebhook, this reconciles against the provider: an existing hook
 * pointing at our payload URL is updated in place (re-activated, correct events
 * and secret), otherwise a fresh one is created. Returns a structured result so
 * the caller can report success or the reason it couldn't proceed.
 */
export async function repairWebhook(opts: {
	connectionId: string | null
	repoUrl: string
	projectId: string
	webhookSecret: string
	origin: string
}): Promise<RepairResult> {
	if (!opts.connectionId) {
		return {
			ok: false,
			reason:
				'No Git connection is linked to this project. Reconnect the repository, or add the webhook manually using the guide below.'
		}
	}

	const [conn] = await db
		.select({ accessToken: gitConnections.accessToken, provider: gitConnections.provider })
		.from(gitConnections)
		.where(eq(gitConnections.id, opts.connectionId))
		.limit(1)

	if (!conn) {
		return {
			ok: false,
			reason:
				'The Git connection linked to this project no longer exists. Reconnect the repository, or add the webhook manually using the guide below.'
		}
	}

	if (conn.provider !== 'github') {
		return {
			ok: false,
			reason:
				'Automatic repair is currently only available for GitHub connections. Re-create the webhook manually using the guide below.'
		}
	}

	const parsed = parseGitHubOwnerRepo(opts.repoUrl)
	if (!parsed) {
		return { ok: false, reason: 'Could not determine the GitHub repository from the project repo URL.' }
	}

	try {
		const token = safeDecrypt(conn.accessToken)
		const webhookUrl = `${opts.origin}/api/webhooks/${opts.projectId}`
		const events = ['push', 'pull_request']
		const client = new GitHubClient(token)

		const hooks = await client.listWebhooks(parsed.owner, parsed.repo)
		const existing = hooks.find((h) => h.config?.url === webhookUrl)

		if (existing) {
			await client.updateWebhook({
				owner: parsed.owner,
				repo: parsed.repo,
				hookId: existing.id,
				webhookUrl,
				secret: opts.webhookSecret,
				events
			})
			return { ok: true, action: 'updated' }
		}

		await client.createWebhook({
			owner: parsed.owner,
			repo: parsed.repo,
			webhookUrl,
			secret: opts.webhookSecret,
			events
		})
		return { ok: true, action: 'created' }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error('[auto-webhook] Failed to repair webhook:', message)
		return {
			ok: false,
			reason: `Could not reach GitHub to repair the webhook: ${message}. Check that the Git connection's token is still valid.`
		}
	}
}
