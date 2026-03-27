import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { db } from '$lib/server/db'
import { gitConnections } from '$lib/server/db/schema'
import { isFirstRun } from '$lib/server/auth-utils'
import { connectForgejo, saveGithubApp, saveGitlabApp } from '$lib/server/git-actions'
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

	const isCloud = env.RISVED_MODE === 'cloud'

	return { connections, isCloud }
}

export const actions: Actions = {
	skip: async () => {
		redirect(303, '/onboarding/deploy')
	},
	forgejo: async ({ request }) => {
		const formData = await request.formData()
		return connectForgejo(formData)
	},
	saveGithubApp: async ({ request }) => {
		const formData = await request.formData()
		return saveGithubApp(formData)
	},
	saveGitlabApp: async ({ request }) => {
		const formData = await request.formData()
		return saveGitlabApp(formData)
	}
}
