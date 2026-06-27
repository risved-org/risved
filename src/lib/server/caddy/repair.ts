import { createCaddyClient } from './index'

/**
 * Re-applies a domain route so Caddy retries certificate automation after DNS changes.
 */
export async function repairDomainRoute(hostname: string, port: number): Promise<boolean> {
	try {
		const caddy = createCaddyClient()
		const route = await caddy.addRoute({ hostname, port })
		if (!route.success) return false

		if (!hostname.startsWith('www.')) {
			const redirect = await caddy.addRedirectRoute(`www.${hostname}`, hostname)
			return redirect.success
		}

		return true
	} catch {
		return false
	}
}
