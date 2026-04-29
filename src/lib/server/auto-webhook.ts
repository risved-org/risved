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
