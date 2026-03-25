import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getSetting } from '$lib/server/settings'
import { exchangeGitHubCode, GitHubClient } from '$lib/server/github'
import { encrypt, decrypt, decryptCallbackToken } from '$lib/server/crypto'
import type { RequestHandler } from './$types'

/**
 * GET /api/git/github/callback
 *
 * Two modes:
 *
 * Proxy mode: risved.com completes the OAuth flow and sends back
 *   ?token=<encrypted_access_token>
 *   Encrypted with CALLBACK_SECRET (AES-256-GCM, 12-byte IV prepended, base64).
 *
 * Custom mode: GitHub redirects directly with
 *   ?code=<auth_code>&state=<state>
 *   Instance exchanges the code for a token itself.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const mode = await getSetting('github_app_mode')
	let accessToken: string

	if (mode === 'custom') {
		/* Custom mode: exchange code for token */
		const code = event.url.searchParams.get('code')
		const state = event.url.searchParams.get('state')
		const savedState = event.cookies.get('github_oauth_state')
		event.cookies.delete('github_oauth_state', { path: '/' })

		if (!code || !state || state !== savedState) {
			return jsonError(400, 'Invalid OAuth callback: missing or mismatched state')
		}

		const clientId = await getSetting('github_app_client_id')
		const encryptedSecret = await getSetting('github_app_client_secret')
		if (!clientId || !encryptedSecret) {
			return jsonError(500, 'Custom GitHub app not configured')
		}

		const tokenData = await exchangeGitHubCode(clientId, decrypt(encryptedSecret), code)
		accessToken = tokenData.access_token
	} else {
		/* Proxy mode: decrypt token from risved.com */
		const encryptedToken = event.url.searchParams.get('token')
		if (!encryptedToken) {
			return jsonError(400, 'Missing token parameter')
		}

		const callbackSecret = env.CALLBACK_SECRET
		if (!callbackSecret) {
			return jsonError(500, 'CALLBACK_SECRET not configured')
		}

		try {
			accessToken = decryptCallbackToken(encryptedToken, callbackSecret)
		} catch {
			return jsonError(400, 'Failed to decrypt callback token')
		}
	}

	const client = new GitHubClient(accessToken)
	const ghUser = await client.getUser()

	/* Upsert connection */
	const existing = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.accountName, ghUser.login))
		.limit(1)

	const encryptedToken = encrypt(accessToken)

	if (existing.length > 0) {
		await db
			.update(gitConnections)
			.set({
				accessToken: encryptedToken,
				avatarUrl: ghUser.avatar_url,
				updatedAt: new Date().toISOString()
			})
			.where(eq(gitConnections.id, existing[0].id))
	} else {
		await db.insert(gitConnections).values({
			provider: 'github',
			accountName: ghUser.login,
			accessToken: encryptedToken,
			avatarUrl: ghUser.avatar_url
		})
	}

	const returnTo = event.cookies.get('github_oauth_redirect') || '/settings/git'
	event.cookies.delete('github_oauth_redirect', { path: '/' })
	redirect(302, returnTo)
}
