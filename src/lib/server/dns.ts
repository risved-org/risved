import { resolve4 } from 'node:dns/promises';

export interface DnsRecord {
	type: 'A' | 'CNAME';
	name: string;
	value: string;
	purpose: string;
}

export interface DnsCheckResult {
	record: DnsRecord;
	resolved: boolean;
}

/**
 * Generates the required DNS records based on domain configuration.
 * Returns an empty array for IP-only mode.
 */
export function generateDnsRecords(
	mode: string,
	baseDomain: string,
	prefix: string,
	serverIp: string
): DnsRecord[] {
	if (mode === 'ip') return [];

	if (mode === 'subdomain') {
		return [
			{
				type: 'A',
				name: `${prefix}.${baseDomain}`,
				value: serverIp,
				purpose: 'Risved dashboard'
			},
			{
				type: 'A',
				name: `*.${baseDomain}`,
				value: serverIp,
				purpose: 'App subdomains & PR previews'
			}
		];
	}

	if (mode === 'dedicated') {
		return [
			{
				type: 'A',
				name: baseDomain,
				value: serverIp,
				purpose: 'Risved dashboard'
			},
			{
				type: 'A',
				name: `*.${baseDomain}`,
				value: serverIp,
				purpose: 'App subdomains & PR previews'
			}
		];
	}

	return [];
}

/**
 * Checks whether a DNS record resolves to the expected IP.
 * Wildcard records are tested by querying a random subdomain.
 */
export async function checkDnsRecord(
	record: DnsRecord,
	resolveFn: (hostname: string) => Promise<string[]> = resolve4
): Promise<DnsCheckResult> {
	let hostname = record.name;

	if (hostname.startsWith('*.')) {
		hostname = `_risved-check.${hostname.slice(2)}`;
	}

	try {
		const addresses = await resolveFn(hostname);
		const resolved = addresses.includes(record.value);
		return { record, resolved };
	} catch {
		return { record, resolved: false };
	}
}

/**
 * Checks all DNS records and returns results.
 */
export async function checkAllDnsRecords(
	records: DnsRecord[],
	resolveFn?: (hostname: string) => Promise<string[]>
): Promise<DnsCheckResult[]> {
	return Promise.all(records.map((r) => checkDnsRecord(r, resolveFn)));
}

/**
 * Returns the server's public IP address.
 * Falls back to '0.0.0.0' if detection fails.
 */
export async function getServerIp(fetchFn: typeof fetch = fetch): Promise<string> {
	try {
		const response = await fetchFn('https://api.ipify.org?format=text', {
			signal: AbortSignal.timeout(5000)
		});
		const ip = (await response.text()).trim();
		if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
	} catch {
		/* fallback below */
	}
	return '0.0.0.0';
}
