import { building } from '$app/environment'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
	if (building || !locals.user) {
		return { updateAvailable: null }
	}

	/* Lazy import to avoid loading update module during build */
	const { getUpdateChecker } = await import('$lib/server/update')
	const checker = getUpdateChecker()
	const info = await checker.getCachedUpdateInfo()

	return {
		updateAvailable: info.updateAvailable
			? { currentVersion: info.currentVersion, latestVersion: info.latestVersion }
			: null
	}
}
