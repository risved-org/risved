import { redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { isFirstRun } from '$lib/server/auth-utils'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async () => {
	const firstRun = await isFirstRun()
	if (firstRun) {
		redirect(303, '/onboarding')
	}

	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl
		})
		.from(gitConnections)

	return { connections }
}

export const actions: Actions = {
	skip: async () => {
		redirect(303, '/onboarding/domain')
	}
}
