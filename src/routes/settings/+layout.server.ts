import os from 'node:os'
import { getSetting } from '$lib/server/settings'
import { _getSystemHealth } from '../(dashboard)/+layout.server'
import type { LayoutServerLoad } from './$types'

export const load = (async (event?: Parameters<LayoutServerLoad>[0]) => {
	void event
	const health = _getSystemHealth()
	const displayName = (await getSetting('display_name')) || ''
	const hostname = (await getSetting('hostname')) || os.hostname()
	return { health, displayName, hostname }
}) satisfies LayoutServerLoad
