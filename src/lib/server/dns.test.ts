import { describe, it, expect, vi } from 'vitest';
import {
	generateDnsRecords,
	checkDnsRecord,
	checkAllDnsRecords,
	getServerIps,
	getServerIp,
	type DnsRecord,
	type ServerIps
} from './dns';

describe('generateDnsRecords', () => {
	const ipv4Only: ServerIps = { ipv4: '1.2.3.4', ipv6: null }
	const ipv6Only: ServerIps = { ipv4: null, ipv6: '2001:db8::1' }
	const dualStack: ServerIps = { ipv4: '1.2.3.4', ipv6: '2001:db8::1' }

	it('returns empty array for ip mode', () => {
		expect(generateDnsRecords('ip', '', '', ipv4Only)).toEqual([])
	})

	it('generates A records for IPv4-only subdomain mode', () => {
		const records = generateDnsRecords('subdomain', 'example.com', 'risved', ipv4Only)
		expect(records).toHaveLength(2)
		expect(records[0]).toEqual({
			type: 'A',
			name: 'risved.example.com',
			value: '1.2.3.4',
			purpose: 'Risved dashboard'
		})
		expect(records[1]).toEqual({
			type: 'A',
			name: '*.example.com',
			value: '1.2.3.4',
			purpose: 'App subdomains & PR previews'
		})
	})

	it('generates AAAA records for IPv6-only subdomain mode', () => {
		const records = generateDnsRecords('subdomain', 'example.com', 'risved', ipv6Only)
		expect(records).toHaveLength(2)
		expect(records[0]).toEqual({
			type: 'AAAA',
			name: 'risved.example.com',
			value: '2001:db8::1',
			purpose: 'Risved dashboard (IPv6)'
		})
		expect(records[1]).toEqual({
			type: 'AAAA',
			name: '*.example.com',
			value: '2001:db8::1',
			purpose: 'App subdomains & PR previews (IPv6)'
		})
	})

	it('generates A + AAAA records for dual-stack subdomain mode', () => {
		const records = generateDnsRecords('subdomain', 'example.com', 'risved', dualStack)
		expect(records).toHaveLength(4)
		expect(records[0].type).toBe('A')
		expect(records[1].type).toBe('A')
		expect(records[2].type).toBe('AAAA')
		expect(records[3].type).toBe('AAAA')
	})

	it('generates A + wildcard A for dedicated mode', () => {
		const records = generateDnsRecords('dedicated', 'deploy.example.com', '', ipv4Only)
		expect(records).toHaveLength(2)
		expect(records[0]).toEqual({
			type: 'A',
			name: 'deploy.example.com',
			value: '1.2.3.4',
			purpose: 'Risved dashboard'
		})
		expect(records[1]).toEqual({
			type: 'A',
			name: '*.deploy.example.com',
			value: '1.2.3.4',
			purpose: 'App subdomains & PR previews'
		})
	})

	it('returns empty for unknown mode', () => {
		expect(generateDnsRecords('unknown', 'x.com', '', ipv4Only)).toEqual([])
	})

	it('uses custom prefix in subdomain name', () => {
		const records = generateDnsRecords('subdomain', 'example.com', 'deploy', ipv4Only)
		expect(records[0].name).toBe('deploy.example.com')
	})

	it('returns empty when no IPs available', () => {
		const noIps: ServerIps = { ipv4: null, ipv6: null }
		expect(generateDnsRecords('subdomain', 'example.com', 'risved', noIps)).toEqual([])
	})
})

describe('checkDnsRecord', () => {
	const record: DnsRecord = {
		type: 'A',
		name: 'risved.example.com',
		value: '1.2.3.4',
		purpose: 'test'
	}

	it('returns resolved when IP matches', async () => {
		const resolveFn = vi.fn().mockResolvedValue(['1.2.3.4'])
		const result = await checkDnsRecord(record, resolveFn)
		expect(result.resolved).toBe(true)
		expect(resolveFn).toHaveBeenCalledWith('risved.example.com')
	})

	it('returns not resolved when IP does not match', async () => {
		const resolveFn = vi.fn().mockResolvedValue(['5.6.7.8'])
		const result = await checkDnsRecord(record, resolveFn)
		expect(result.resolved).toBe(false)
	})

	it('returns not resolved on DNS error', async () => {
		const resolveFn = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
		const result = await checkDnsRecord(record, resolveFn)
		expect(result.resolved).toBe(false)
	})

	it('queries _risved-check subdomain for wildcard records', async () => {
		const wildcard: DnsRecord = {
			type: 'A',
			name: '*.example.com',
			value: '1.2.3.4',
			purpose: 'test'
		}
		const resolveFn = vi.fn().mockResolvedValue(['1.2.3.4'])
		await checkDnsRecord(wildcard, resolveFn)
		expect(resolveFn).toHaveBeenCalledWith('_risved-check.example.com')
	})

	it('includes original record in result', async () => {
		const resolveFn = vi.fn().mockResolvedValue([])
		const result = await checkDnsRecord(record, resolveFn)
		expect(result.record).toBe(record)
	})

	it('works with AAAA records', async () => {
		const aaaa: DnsRecord = {
			type: 'AAAA',
			name: 'risved.example.com',
			value: '2001:db8::1',
			purpose: 'test'
		}
		const resolveFn = vi.fn().mockResolvedValue(['2001:db8::1'])
		const result = await checkDnsRecord(aaaa, resolveFn)
		expect(result.resolved).toBe(true)
	})

	it('matches AAAA records with different IPv6 formats', async () => {
		const aaaa: DnsRecord = {
			type: 'AAAA',
			name: 'risved.example.com',
			value: '2001:db8::1',
			purpose: 'test'
		}
		const resolveFn = vi.fn().mockResolvedValue(['2001:0db8:0000:0000:0000:0000:0000:0001'])
		const result = await checkDnsRecord(aaaa, resolveFn)
		expect(result.resolved).toBe(true)
	})

	it('matches expanded IPv6 value against compressed resolver result', async () => {
		const aaaa: DnsRecord = {
			type: 'AAAA',
			name: 'risved.example.com',
			value: '2001:0db8:0000:0000:0000:0000:0000:0001',
			purpose: 'test'
		}
		const resolveFn = vi.fn().mockResolvedValue(['2001:db8::1'])
		const result = await checkDnsRecord(aaaa, resolveFn)
		expect(result.resolved).toBe(true)
	})
})

describe('checkAllDnsRecords', () => {
	it('checks all records in parallel', async () => {
		const records: DnsRecord[] = [
			{ type: 'A', name: 'a.example.com', value: '1.2.3.4', purpose: 'test' },
			{ type: 'A', name: 'b.example.com', value: '1.2.3.4', purpose: 'test' }
		]
		const resolveFn = vi.fn().mockResolvedValue(['1.2.3.4'])
		const results = await checkAllDnsRecords(records, resolveFn)
		expect(results).toHaveLength(2)
		expect(results.every((r) => r.resolved)).toBe(true)
	})

	it('returns mixed results', async () => {
		const records: DnsRecord[] = [
			{ type: 'A', name: 'a.example.com', value: '1.2.3.4', purpose: 'test' },
			{ type: 'A', name: 'b.example.com', value: '1.2.3.4', purpose: 'test' }
		]
		const resolveFn = vi.fn().mockResolvedValueOnce(['1.2.3.4']).mockResolvedValueOnce(['9.9.9.9'])
		const results = await checkAllDnsRecords(records, resolveFn)
		expect(results[0].resolved).toBe(true)
		expect(results[1].resolved).toBe(false)
	})
})

describe('getServerIps', () => {
	it('returns both IPv4 and IPv6', async () => {
		const mockFetch = vi.fn()
			.mockResolvedValueOnce({ text: () => Promise.resolve('93.184.216.34') })
			.mockResolvedValueOnce({ text: () => Promise.resolve('2001:db8::1') })
		const ips = await getServerIps(mockFetch as unknown as typeof fetch)
		expect(ips.ipv4).toBe('93.184.216.34')
		expect(ips.ipv6).toBe('2001:db8::1')
	})

	it('returns null for IPv6 when not available', async () => {
		const mockFetch = vi.fn()
			.mockResolvedValueOnce({ text: () => Promise.resolve('93.184.216.34') })
			.mockRejectedValueOnce(new Error('network'))
		const ips = await getServerIps(mockFetch as unknown as typeof fetch)
		expect(ips.ipv4).toBe('93.184.216.34')
		expect(ips.ipv6).toBeNull()
	})

	it('returns null for IPv4 when not available', async () => {
		const mockFetch = vi.fn()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce({ text: () => Promise.resolve('2001:db8::1') })
		const ips = await getServerIps(mockFetch as unknown as typeof fetch)
		expect(ips.ipv4).toBeNull()
		expect(ips.ipv6).toBe('2001:db8::1')
	})

	it('returns both null when nothing available', async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error('network'))
		const ips = await getServerIps(mockFetch as unknown as typeof fetch)
		expect(ips.ipv4).toBeNull()
		expect(ips.ipv6).toBeNull()
	})
})

describe('getServerIp (deprecated)', () => {
	it('returns IPv4 from ipify', async () => {
		const mockFetch = vi.fn()
			.mockResolvedValueOnce({ text: () => Promise.resolve('93.184.216.34') })
			.mockRejectedValueOnce(new Error('no ipv6'))
		const ip = await getServerIp(mockFetch as unknown as typeof fetch)
		expect(ip).toBe('93.184.216.34')
	})

	it('returns 0.0.0.0 on fetch error', async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error('network'))
		const ip = await getServerIp(mockFetch as unknown as typeof fetch)
		expect(ip).toBe('0.0.0.0')
	})
})
