import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getSetting } from '$lib/server/settings'
import { exchangeGitLabCode, GitLabClient } from '$lib/server/gitlab'
import { encrypt, decrypt, decryptCallbackToken } from '$lib/server/crypto'
import type { RequestHandler } from './$types'

/**
 * GET /api/git/gitlab/callback
 *
 * Two modes:
 *
 * Proxy mode: risved.com completes the OAuth flow and sends back
 *   ?token=<encrypted_access_token>&refresh_token=<encrypted>&expires_in=<seconds>
 *   Encrypted with CALLBACK_SECRET (AES-256-GCM, 12-byte IV prepended, base64).
 *
 * Custom mode: GitLab redirects directly with
 *   ?code=<auth_code>&state=<state>
 *   Instance exchanges the code for a token itself.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const mode = await getSetting('gitlab_app_mode')
	let accessToken: string
	let refreshToken: string | null = null
	let expiresIn = 7200
	let instanceUrl = 'https://gitlab.com'

	if (mode === 'custom') {
		/* Custom mode: exchange code for token */
		const code = event.url.searchParams.get('code')
		const state = event.url.searchParams.get('state')
		const savedState = event.cookies.get('gitlab_oauth_state')
		event.cookies.delete('gitlab_oauth_state', { path: '/' })

		if (!code || !state || state !== savedState) {
			return jsonError(400, 'Invalid OAuth callback: missing or mismatched state')
		}

		const clientId = await getSetting('gitlab_client_id')
		const encryptedSecret = await getSetting('gitlab_client_secret')
		instanceUrl = await getSetting('gitlab_instance_url') || 'https://gitlab.com'
		if (!clientId || !encryptedSecret) {
			return jsonError(500, 'Custom GitLab app not configured')
		}

		const redirectUri = `${event.url.origin}/api/git/gitlab/callback`
		const tokenData = await exchangeGitLabCode(
			clientId,
			decrypt(encryptedSecret),
			code,
			redirectUri,
			instanceUrl
		)
		accessToken = tokenData.access_token
		refreshToken = tokenData.refresh_token || null
		expiresIn = tokenData.expires_in || 7200
	} else {
		/* Proxy mode: decrypt tokens from risved.com */
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

		const encryptedRefresh = event.url.searchParams.get('refresh_token')
		if (encryptedRefresh) {
			try {
				refreshToken = decryptCallbackToken(encryptedRefresh, callbackSecret)
			} catch {
				/* Non-fatal: proceed without refresh token */
			}
		}

		const expiresParam = event.url.searchParams.get('expires_in')
		if (expiresParam) {
			expiresIn = parseInt(expiresParam, 10) || 7200
		}
	}

	const client = new GitLabClient(accessToken, instanceUrl)
	const glUser = await client.getUser()

	/* Upsert connection */
	const existing = await db
		.select()
		.from(gitConnections)
		.where(
			and(eq(gitConnections.provider, 'gitlab'), eq(gitConnections.accountName, glUser.username))
		)
		.limit(1)

	const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
	const encryptedAccess = encrypt(accessToken)
	const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null

	if (existing.length > 0) {
		await db
			.update(gitConnections)
			.set({
				accessToken: encryptedAccess,
				refreshToken: encryptedRefresh,
				tokenExpiresAt: expiresAt,
				instanceUrl,
				avatarUrl: glUser.avatar_url,
				updatedAt: new Date().toISOString()
			})
			.where(eq(gitConnections.id, existing[0].id))
	} else {
		await db.insert(gitConnections).values({
			provider: 'gitlab',
			accountName: glUser.username,
			accessToken: encryptedAccess,
			refreshToken: encryptedRefresh,
			tokenExpiresAt: expiresAt,
			instanceUrl,
			avatarUrl: glUser.avatar_url
		})
	}

	const returnTo = event.cookies.get('gitlab_oauth_redirect') || '/settings/git'
	event.cookies.delete('gitlab_oauth_redirect', { path: '/' })
	redirect(302, returnTo)
}
