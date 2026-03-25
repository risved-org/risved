import { json, redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getSetting } from '$lib/server/settings'
import { getGitLabAuthUrl } from '$lib/server/gitlab'
import { decrypt } from '$lib/server/crypto'
import type { RequestHandler } from './$types'

const RISVED_PROXY = 'https://risved.com/callback/gitlab/start'

/**
 * Resolve custom GitLab OAuth credentials from settings DB.
 * Returns null if not in custom mode or credentials are missing.
 */
async function getCustomGitLabCredentials(): Promise<{ clientId: string, clientSecret: string, instanceUrl: string } | null> {
	const mode = await getSetting('gitlab_app_mode')
	if (mode !== 'custom') return null

	const clientId = await getSetting('gitlab_client_id')
	const encryptedSecret = await getSetting('gitlab_client_secret')
	const instanceUrl = await getSetting('gitlab_instance_url') || 'https://gitlab.com'
	if (!clientId || !encryptedSecret) return null
	return { clientId, clientSecret: decrypt(encryptedSecret), instanceUrl }
}

/**
 * GET /api/git/gitlab
 * ?action=connect → initiate OAuth (proxy or custom)
 * default → list connections
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const action = event.url.searchParams.get('action')

	if (action === 'connect') {
		const returnTo = event.url.searchParams.get('redirect')
		if (returnTo) {
			event.cookies.set('gitlab_oauth_redirect', returnTo, {
				path: '/',
				httpOnly: true,
				secure: false,
				maxAge: 600
			})
		}

		const customCreds = await getCustomGitLabCredentials()

		if (customCreds) {
			/* Custom mode: redirect directly to GitLab */
			const state = crypto.randomUUID()
			event.cookies.set('gitlab_oauth_state', state, {
				path: '/',
				httpOnly: true,
				secure: false,
				maxAge: 600
			})

			const redirectUri = `${event.url.origin}/api/git/gitlab/callback`
			const authUrl = getGitLabAuthUrl(customCreds.clientId, redirectUri, state, customCreds.instanceUrl)
			redirect(302, authUrl)
		}

		/* Proxy mode: redirect to risved.com */
		const instanceUrl = event.url.origin
		const proxyUrl = `${RISVED_PROXY}?instance=${encodeURIComponent(instanceUrl)}`
		redirect(302, proxyUrl)
	}

	/* Default: list GitLab connections */
	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections)
		.where(eq(gitConnections.provider, 'gitlab'))

	return json(connections)
}

/**
 * DELETE /api/git/gitlab — disconnect a GitLab connection.
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
