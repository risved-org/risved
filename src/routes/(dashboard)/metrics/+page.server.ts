import { getServerMetrics } from '$lib/server/metrics'
import type { PageServerLoad } from './$types'

export const load = (async ({ url }) => {
	const hoursParam = parseInt(url.searchParams.get('hours') ?? '24', 10)
	const hours = [6, 12, 24, 48, 168].includes(hoursParam) ? hoursParam : 24
	const serverMetrics = await getServerMetrics(hours)
	return { serverMetrics, hours }
}) satisfies PageServerLoad
