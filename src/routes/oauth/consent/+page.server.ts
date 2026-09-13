import { error, fail, redirect } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { auth } from '$lib/server/auth'
import { db } from '$lib/server/db'
import { oauthApplication, verification } from '$lib/server/db/schema'
import type { Actions, PageServerLoad } from './$types'

/** Resolve the pending grant from the server, bound to the signed-in user. */
async function pendingGrant(code: string, userId: string) {
	const [record] = await db
		.select()
		.from(verification)
		.where(eq(verification.identifier, code))
		.limit(1)
	if (!record || record.expiresAt <= new Date()) error(400, 'This access request has expired')
	const grant = JSON.parse(record.value) as {
		userId: string
		clientId: string
		requireConsent: boolean
		state?: string
	}
	if (grant.userId !== userId || !grant.requireConsent) error(403, 'Invalid access request')
	return grant
}

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Sign in to approve access')
	const code = url.searchParams.get('consent_code') ?? ''
	const grant = await pendingGrant(code, locals.user.id)
	const [client] = await db
		.select()
		.from(oauthApplication)
		.where(eq(oauthApplication.clientId, grant.clientId))
		.limit(1)
	if (!client || client.disabled) error(400, 'This client is unavailable')
	return { code, clientName: client.name || 'Unnamed MCP client' }
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) error(401, 'Sign in to approve access')
		const form = await request.formData()
		const code = form.get('code')?.toString() ?? ''
		const grant = await pendingGrant(code, locals.user.id)
		let destination: string
		try {
			const result = await auth.api.oAuthConsent({
				headers: request.headers,
				body: { accept: form.get('decision') === 'allow', consent_code: code }
			})
			const target = new URL(result.redirectURI)
			if (grant.state) target.searchParams.set('state', grant.state)
			destination = target.toString()
		} catch {
			return fail(400, {
				error: 'This access request could not be completed. Start again from your MCP client.'
			})
		}
		redirect(303, destination)
	}
}
