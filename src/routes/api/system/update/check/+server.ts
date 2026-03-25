import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { requireAuth } from '$lib/server/api-utils'
import { getUpdateChecker } from '$lib/server/update'

/** Force a fresh check for updates (hits the remote server). */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event)

	const checker = getUpdateChecker()
	const info = await checker.checkForUpdates()

	return json(info)
}
