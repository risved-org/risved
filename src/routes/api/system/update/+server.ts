import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { requireAuth } from '$lib/server/api-utils'
import { getUpdateChecker } from '$lib/server/update'

/** Check for updates — returns current and latest version info. */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const checker = getUpdateChecker()
	const info = await checker.getCachedUpdateInfo()

	return json(info)
}

/** Trigger an update to the latest version. */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event)

	const checker = getUpdateChecker()

	if (checker.isUpdating()) {
		return json({ error: 'An update is already in progress' }, { status: 409 })
	}

	/* Run a fresh check to get the latest version */
	const info = await checker.checkForUpdates()

	if (!info.updateAvailable || !info.latestVersion) {
		return json({ error: 'No update available' }, { status: 400 })
	}

	const preflight = await checker.preflightCheck()
	if (!preflight.ok) {
		return json({ error: preflight.reason }, { status: 400 })
	}

	/* Run update in the background */
	const targetVersion = info.latestVersion
	queueMicrotask(async () => {
		try {
			await checker.performUpdate(targetVersion)
		} catch {
			/* Error stored in settings by performUpdate */
		}
	})

	return json({ status: 'updating', targetVersion })
}
