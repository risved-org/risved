import { getSetting } from '$lib/server/settings'

interface DomainConfig {
	mode?: string
	baseDomain?: string
}

/**
 * Returns the built-in app hostname that should exist under the configured wildcard DNS.
 */
export async function getManagedAppDomain(projectSlug: string, currentDomain?: string): Promise<string | null> {
	const raw = await getSetting('domain_config')
	if (!raw) return null

	let config: DomainConfig
	try {
		config = JSON.parse(raw)
	} catch {
		return null
	}

	if (config.mode !== 'subdomain' || !config.baseDomain) return null

	const domain = `${projectSlug}.${config.baseDomain}`
	return currentDomain === domain ? null : domain
}
