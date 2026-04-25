import { json, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getSetting } from '$lib/server/settings'
import { getGitHubAuthUrl } from '$lib/server/github'
import { decrypt } from '$lib/server/crypto'
import type { RequestHandler } from './$types'

const RISVED_PROXY = 'https://risved.com/callback/github/start'

/**
 * Resolve GitHub OAuth credentials for custom mode.
 * Returns null if not in custom mode or credentials are missing.
 */
async function getCustomGitHubCredentials(): Promise<{ clientId: string, clientSecret: string } | null> {
	const mode = await getSetting('github_app_mode')
	if (mode !== 'custom') return null

	const clientId = await getSetting('github_app_client_id')
	const encryptedSecret = await getSetting('github_app_client_secret')
	if (!clientId || !encryptedSecret) return null
	return { clientId, clientSecret: decrypt(encryptedSecret) }
}

/**
 * GET /api/git/github
 * ?action=connect → initiate OAuth (proxy or custom)
 * default → list connections
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const action = event.url.searchParams.get('action')

	if (action === 'connect') {
		const returnTo = event.url.searchParams.get('redirect')
		if (returnTo) {
			event.cookies.set('github_oauth_redirect', returnTo, {
				path: '/',
				httpOnly: true,
				secure: false,
				maxAge: 600
			})
		}

		const customCreds = await getCustomGitHubCredentials()

		if (customCreds) {
			/* Custom mode: redirect directly to GitHub */
			const state = crypto.randomUUID()
			event.cookies.set('github_oauth_state', state, {
				path: '/',
				httpOnly: true,
				secure: false,
				maxAge: 600
			})

			const redirectUri = `${event.url.origin}/api/git/github/callback`
			const authUrl = getGitHubAuthUrl(customCreds.clientId, redirectUri, state)
			redirect(302, authUrl)
		}

		/* Proxy mode: redirect to risved.com which handles the GitHub OAuth */
		const callbackSecret = env.CALLBACK_SECRET
		if (!callbackSecret) {
			return jsonError(500, 'CALLBACK_SECRET not configured')
		}
		const instanceUrl = event.url.origin
		const proxyUrl = `${RISVED_PROXY}?instance=${encodeURIComponent(instanceUrl)}&secret=${encodeURIComponent(callbackSecret)}`
		redirect(302, proxyUrl)
	}

	/* Default: list GitHub connections */
	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections)
		.where(eq(gitConnections.provider, 'github'))

	return json(connections)
}

/**
 * DELETE /api/git/github — disconnect a GitHub connection.
 * Body: { connectionId }
 */
export const DELETE: RequestHandler = async (event) => {
	await requireAuth(event)

	const body = await event.request.json().catch(() => null)
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body')
	}

	const { connectionId } = body as Record<string, unknown>
	if (!connectionId || typeof connectionId !== 'string') {
		return jsonError(400, 'connectionId is required')
	}

	await db.delete(gitConnections).where(eq(gitConnections.id, connectionId))

	return json({ success: true })
}
