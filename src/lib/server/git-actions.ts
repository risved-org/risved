import { fail } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { verifyForgejoToken } from '$lib/server/forgejo'
import { encrypt } from '$lib/server/crypto'
import { setSetting } from '$lib/server/settings'

/** Connect a Forgejo/Gitea/Codeberg instance with API token. */
export async function connectForgejo(formData: FormData) {
	const instanceUrl = (formData.get('instanceUrl') as string)?.trim()
	const token = (formData.get('token') as string)?.trim()

	if (!instanceUrl) return fail(400, { forgejoError: 'Instance URL is required' })
	if (!token) return fail(400, { forgejoError: 'API token is required' })

	try {
		new URL(instanceUrl)
	} catch {
		return fail(400, { forgejoError: 'Invalid URL format' })
	}

	let user
	try {
		user = await verifyForgejoToken(instanceUrl, token)
	} catch {
		return fail(400, { forgejoError: 'Could not connect — check URL and token' })
	}

	const existing = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.accountName, user.login))
		.limit(1)

	const encryptedToken = encrypt(token)

	if (existing.length > 0) {
		await db
			.update(gitConnections)
			.set({
				accessToken: encryptedToken,
				instanceUrl: instanceUrl.replace(/\/+$/, ''),
				avatarUrl: user.avatar_url,
				updatedAt: new Date().toISOString()
			})
			.where(eq(gitConnections.id, existing[0].id))
	} else {
		await db.insert(gitConnections).values({
			provider: 'forgejo',
			accountName: user.login,
			instanceUrl: instanceUrl.replace(/\/+$/, ''),
			accessToken: encryptedToken,
			avatarUrl: user.avatar_url
		})
	}

	return { forgejoConnected: true, accountName: user.login }
}

/** Save custom GitHub App credentials (self-hosted only). */
export async function saveGithubApp(formData: FormData) {
	const appId = (formData.get('appId') as string)?.trim()
	const privateKey = (formData.get('privateKey') as string)?.trim()
	const clientId = (formData.get('clientId') as string)?.trim()
	const clientSecret = (formData.get('clientSecret') as string)?.trim()

	if (!appId || !privateKey || !clientId || !clientSecret) {
		return fail(400, { githubAppError: 'All fields are required' })
	}

	await setSetting('github_app_mode', 'custom')
	await setSetting('github_app_id', appId)
	await setSetting('github_app_private_key', encrypt(privateKey))
	await setSetting('github_app_client_id', clientId)
	await setSetting('github_app_client_secret', encrypt(clientSecret))

	return { githubAppSaved: true }
}

/** Save custom GitLab OAuth credentials (self-hosted only). */
export async function saveGitlabApp(formData: FormData) {
	const instanceUrl = (formData.get('instanceUrl') as string)?.trim()
	const applicationId = (formData.get('applicationId') as string)?.trim()
	const secret = (formData.get('secret') as string)?.trim()

	if (!instanceUrl || !applicationId || !secret) {
		return fail(400, { gitlabAppError: 'All fields are required' })
	}

	try {
		new URL(instanceUrl)
	} catch {
		return fail(400, { gitlabAppError: 'Invalid URL format' })
	}

	await setSetting('gitlab_app_mode', 'custom')
	await setSetting('gitlab_instance_url', instanceUrl.replace(/\/+$/, ''))
	await setSetting('gitlab_client_id', applicationId)
	await setSetting('gitlab_client_secret', encrypt(secret))

	return { gitlabAppSaved: true }
}
