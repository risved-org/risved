import { describe, it, expect, vi } from 'vitest';
import {
	generateDnsRecords,
	checkDnsRecord,
	checkAllDnsRecords,
	getServerIp,
	type DnsRecord
} from './dns';

describe('generateDnsRecords', () => {
	const ip = '1.2.3.4';

	it('returns empty array for ip mode', () => {
		expect(generateDnsRecords('ip', '', '', ip)).toEqual([]);
	});

	it('generates A + wildcard A for subdomain mode', () => {
		const records = generateDnsRecords('subdomain', 'example.com', 'risved', ip);
		expect(records).toHaveLength(2);
		expect(records[0]).toEqual({
			type: 'A',
			name: 'risved.example.com',
			value: ip,
			purpose: 'Risved dashboard'
		});
		expect(records[1]).toEqual({
			type: 'A',
			name: '*.example.com',
			value: ip,
			purpose: 'App subdomains & PR previews'
		});
	});

	it('generates A + wildcard A for dedicated mode', () => {
		const records = generateDnsRecords('dedicated', 'deploy.example.com', '', ip);
		expect(records).toHaveLength(2);
		expect(records[0]).toEqual({
			type: 'A',
			name: 'deploy.example.com',
			value: ip,
			purpose: 'Risved dashboard'
		});
		expect(records[1]).toEqual({
			type: 'A',
			name: '*.deploy.example.com',
			value: ip,
			purpose: 'App subdomains & PR previews'
		});
	});

	it('returns empty for unknown mode', () => {
		expect(generateDnsRecords('unknown', 'x.com', '', ip)).toEqual([]);
	});

	it('uses custom prefix in subdomain name', () => {
		const records = generateDnsRecords('subdomain', 'example.com', 'deploy', ip);
		expect(records[0].name).toBe('deploy.example.com');
	});
});

describe('checkDnsRecord', () => {
	const record: DnsRecord = {
		type: 'A',
		name: 'risved.example.com',
		value: '1.2.3.4',
		purpose: 'test'
	};

	it('returns resolved when IP matches', async () => {
		const resolveFn = vi.fn().mockResolvedValue(['1.2.3.4']);
		const result = await checkDnsRecord(record, resolveFn);
		expect(result.resolved).toBe(true);
		expect(resolveFn).toHaveBeenCalledWith('risved.example.com');
	});

	it('returns not resolved when IP does not match', async () => {
		const resolveFn = vi.fn().mockResolvedValue(['5.6.7.8']);
		const result = await checkDnsRecord(record, resolveFn);
		expect(result.resolved).toBe(false);
	});

	it('returns not resolved on DNS error', async () => {
		const resolveFn = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
		const result = await checkDnsRecord(record, resolveFn);
		expect(result.resolved).toBe(false);
	});

	it('queries _risved-check subdomain for wildcard records', async () => {
		const wildcard: DnsRecord = {
			type: 'A',
			name: '*.example.com',
			value: '1.2.3.4',
			purpose: 'test'
		};
		const resolveFn = vi.fn().mockResolvedValue(['1.2.3.4']);
		await checkDnsRecord(wildcard, resolveFn);
		expect(resolveFn).toHaveBeenCalledWith('_risved-check.example.com');
	});

	it('includes original record in result', async () => {
		const resolveFn = vi.fn().mockResolvedValue([]);
		const result = await checkDnsRecord(record, resolveFn);
		expect(result.record).toBe(record);
	});
});

describe('checkAllDnsRecords', () => {
	it('checks all records in parallel', async () => {
		const records: DnsRecord[] = [
			{ type: 'A', name: 'a.example.com', value: '1.2.3.4', purpose: 'test' },
			{ type: 'A', name: 'b.example.com', value: '1.2.3.4', purpose: 'test' }
		];
		const resolveFn = vi.fn().mockResolvedValue(['1.2.3.4']);
		const results = await checkAllDnsRecords(records, resolveFn);
		expect(results).toHaveLength(2);
		expect(results.every((r) => r.resolved)).toBe(true);
	});

	it('returns mixed results', async () => {
		const records: DnsRecord[] = [
			{ type: 'A', name: 'a.example.com', value: '1.2.3.4', purpose: 'test' },
			{ type: 'A', name: 'b.example.com', value: '1.2.3.4', purpose: 'test' }
		];
		const resolveFn = vi.fn().mockResolvedValueOnce(['1.2.3.4']).mockResolvedValueOnce(['9.9.9.9']);
		const results = await checkAllDnsRecords(records, resolveFn);
		expect(results[0].resolved).toBe(true);
		expect(results[1].resolved).toBe(false);
	});
});

describe('getServerIp', () => {
	it('returns IP from ipify', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			text: () => Promise.resolve('93.184.216.34')
		});
		const ip = await getServerIp(mockFetch as unknown as typeof fetch);
		expect(ip).toBe('93.184.216.34');
	});

	it('returns 0.0.0.0 on fetch error', async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error('network'));
		const ip = await getServerIp(mockFetch as unknown as typeof fetch);
		expect(ip).toBe('0.0.0.0');
	});

	it('returns 0.0.0.0 for invalid IP response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			text: () => Promise.resolve('not-an-ip')
		});
		const ip = await getServerIp(mockFetch as unknown as typeof fetch);
		expect(ip).toBe('0.0.0.0');
	});
});
