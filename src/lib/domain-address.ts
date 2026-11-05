/** Build the public address of a domain mapping, including its mount location. */
export function domainAddress(mapping: { hostname: string; pathPrefix?: string }): string {
	const prefix = mapping.pathPrefix ?? '/'
	return `${mapping.hostname}${prefix === '/' ? '' : prefix}`
}
