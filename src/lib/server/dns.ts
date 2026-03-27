import { resolve4, resolve6 } from 'node:dns/promises'
import { isIPv6 } from 'node:net'

export interface DnsRecord {
	type: 'A' | 'AAAA' | 'CNAME';
	name: string;
	value: string;
	purpose: string;
}

export interface DnsCheckResult {
	record: DnsRecord;
	resolved: boolean;
}

export interface ServerIps {
	ipv4: string | null;
	ipv6: string | null;
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6_RE = /^[0-9a-fA-F:]+$/

/** Expand an IPv6 address to its full 8-group lowercase form for reliable comparison. */
function normalizeIPv6(addr: string): string {
	if (!isIPv6(addr)) return addr.toLowerCase()
	const halves = addr.split('::')
	const expand = (s: string) => s ? s.split(':') : []
	const left = expand(halves[0])
	const right = halves.length > 1 ? expand(halves[1]) : []
	const missing = 8 - left.length - right.length
	const full = [...left, ...Array(missing).fill('0'), ...right]
	return full.map(g => g.padStart(4, '0').toLowerCase()).join(':')
}

/**
 * Generates the required DNS records based on domain configuration.
 * Returns an empty array for IP-only mode.
 * Generates both A and AAAA records when IPv6 is available.
 */
export function generateDnsRecords(
	mode: string,
	baseDomain: string,
	prefix: string,
	serverIps: ServerIps
): DnsRecord[] {
	if (mode !== 'subdomain' && mode !== 'dedicated') return []

	const dashboardName = mode === 'subdomain' ? `${prefix}.${baseDomain}` : baseDomain
	const wildcardName = `*.${baseDomain}`

	const records: DnsRecord[] = []

	if (serverIps.ipv4) {
		records.push(
			{ type: 'A', name: dashboardName, value: serverIps.ipv4, purpose: 'Risved dashboard' },
			{ type: 'A', name: wildcardName, value: serverIps.ipv4, purpose: 'App subdomains & PR previews' }
		)
	}

	if (serverIps.ipv6) {
		records.push(
			{ type: 'AAAA', name: dashboardName, value: serverIps.ipv6, purpose: 'Risved dashboard (IPv6)' },
			{ type: 'AAAA', name: wildcardName, value: serverIps.ipv6, purpose: 'App subdomains & PR previews (IPv6)' }
		)
	}

	return records
}

/**
 * Returns the default resolver for the given record type.
 */
function defaultResolver(record: DnsRecord): (hostname: string) => Promise<string[]> {
	return record.type === 'AAAA' ? resolve6 : resolve4
}

/**
 * Checks whether a DNS record resolves to the expected IP.
 * Wildcard records are tested by querying a random subdomain.
 */
export async function checkDnsRecord(
	record: DnsRecord,
	resolveFn?: (hostname: string) => Promise<string[]>
): Promise<DnsCheckResult> {
	const resolver = resolveFn ?? defaultResolver(record)
	let hostname = record.name

	if (hostname.startsWith('*.')) {
		hostname = `_risved-check.${hostname.slice(2)}`
	}

	try {
		const addresses = await resolver(hostname)
		const expected = record.type === 'AAAA' ? normalizeIPv6(record.value) : record.value
		const resolved = record.type === 'AAAA'
			? addresses.some(a => normalizeIPv6(a) === expected)
			: addresses.includes(expected)
		return { record, resolved }
	} catch {
		return { record, resolved: false }
	}
}

/**
 * Checks all DNS records and returns results.
 */
export async function checkAllDnsRecords(
	records: DnsRecord[],
	resolveFn?: (hostname: string) => Promise<string[]>
): Promise<DnsCheckResult[]> {
	return Promise.all(records.map((r) => checkDnsRecord(r, resolveFn)))
}

/**
 * Returns the server's public IPv4 and IPv6 addresses.
 * Either may be null if not available.
 */
export async function getServerIps(fetchFn: typeof fetch = fetch): Promise<ServerIps> {
	const [ipv4, ipv6] = await Promise.all([
		fetchIp(fetchFn, 'https://api.ipify.org?format=text', IPV4_RE),
		fetchIp(fetchFn, 'https://api6.ipify.org?format=text', IPV6_RE)
	])
	return { ipv4, ipv6 }
}

async function fetchIp(fetchFn: typeof fetch, url: string, pattern: RegExp): Promise<string | null> {
	try {
		const response = await fetchFn(url, { signal: AbortSignal.timeout(5000) })
		const ip = (await response.text()).trim()
		if (pattern.test(ip)) return ip
	} catch {
		/* not available */
	}
	return null
}

/**
 * Returns the server's public IPv4 address.
 * @deprecated Use getServerIps() instead for dual-stack support.
 */
export async function getServerIp(fetchFn: typeof fetch = fetch): Promise<string> {
	const ips = await getServerIps(fetchFn)
	return ips.ipv4 ?? '0.0.0.0'
}
