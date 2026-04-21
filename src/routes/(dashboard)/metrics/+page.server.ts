import { getServerMetrics } from '$lib/server/metrics'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
	const serverMetrics = await getServerMetrics(24)
	return { serverMetrics }
}
