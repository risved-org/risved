import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/auth-utils', () => ({
	isFirstRun: vi.fn()
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn(),
	setSetting: vi.fn()
}));

vi.mock('$lib/server/dns', () => ({
	generateDnsRecords: vi.fn(),
	checkAllDnsRecords: vi.fn(),
	getServerIps: vi.fn()
}));

import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';
import { generateDnsRecords, checkAllDnsRecords, getServerIps } from '$lib/server/dns';
import { load, actions } from './+page.server';

type LoadParams = Parameters<typeof load>[0];
type ActionParams = Parameters<typeof actions.check>[0];

function makeActionEvent(action: string): ActionParams {
	const formData = new FormData();
	return {
		request: {
			formData: () => Promise.resolve(formData),
			headers: new Headers()
		},
		url: new URL(`http://localhost/onboarding/verify?/${action}`)
	} as ActionParams;
}

describe('verify load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /onboarding if first run', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(true);
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding'
		});
	});

	it('redirects to /onboarding/domain if no domain config', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue(null);
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/domain'
		});
	});

	it('redirects to /onboarding/domain on corrupt config', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue('{broken');
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/domain'
		});
	});

	it('auto-skips to git for IP mode', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue(
			JSON.stringify({ mode: 'ip', baseDomain: '', prefix: '' })
		);
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/git'
		});
		expect(setSetting).toHaveBeenCalledWith('dns_verified', 'true');
	});

	it('returns records and config for subdomain mode', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		const config = { mode: 'subdomain', baseDomain: 'example.com', prefix: 'risved' };
		vi.mocked(getSetting).mockResolvedValueOnce(JSON.stringify(config)).mockResolvedValueOnce(null);
		vi.mocked(getServerIps).mockResolvedValue({ ipv4: '1.2.3.4', ipv6: null });
		const mockRecords = [
			{ type: 'A', name: 'risved.example.com', value: '1.2.3.4', purpose: 'Dashboard' }
		];
		vi.mocked(generateDnsRecords).mockReturnValue(mockRecords as never);

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.domainConfig).toEqual(config);
		expect(result.serverIps).toEqual({ ipv4: '1.2.3.4', ipv6: null });
		expect(result.records).toEqual(mockRecords);
		expect(result.dnsVerified).toBe(false);
	});

	it('returns dnsVerified true when setting exists', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		const config = { mode: 'dedicated', baseDomain: 'example.com', prefix: '' };
		vi.mocked(getSetting)
			.mockResolvedValueOnce(JSON.stringify(config))
			.mockResolvedValueOnce('true');
		vi.mocked(getServerIps).mockResolvedValue({ ipv4: '1.2.3.4', ipv6: null });
		vi.mocked(generateDnsRecords).mockReturnValue([]);

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.dnsVerified).toBe(true);
	});
});

describe('verify check action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects if no domain config', async () => {
		vi.mocked(getSetting).mockResolvedValue(null);
		await expect(actions.check(makeActionEvent('check'))).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/domain'
		});
	});

	it('returns results when DNS not resolved', async () => {
		const config = { mode: 'subdomain', baseDomain: 'example.com', prefix: 'risved' };
		vi.mocked(getSetting).mockResolvedValue(JSON.stringify(config));
		vi.mocked(getServerIps).mockResolvedValue({ ipv4: '1.2.3.4', ipv6: null });
		const records = [
			{ type: 'A', name: 'risved.example.com', value: '1.2.3.4', purpose: 'Dashboard' },
			{ type: 'A', name: '*.example.com', value: '1.2.3.4', purpose: 'Apps' }
		];
		vi.mocked(generateDnsRecords).mockReturnValue(records as never);
		vi.mocked(checkAllDnsRecords).mockResolvedValue([
			{ record: records[0] as never, resolved: false },
			{ record: records[1] as never, resolved: false }
		]);

		const result = await actions.check(makeActionEvent('check'));
		expect(result).toMatchObject({
			allResolved: false,
			results: [
				{ name: 'risved.example.com', type: 'A', resolved: false },
				{ name: '*.example.com', type: 'A', resolved: false }
			]
		});
		expect(setSetting).not.toHaveBeenCalled();
	});

	it('sets dns_verified when all records resolve', async () => {
		const config = { mode: 'subdomain', baseDomain: 'example.com', prefix: 'risved' };
		vi.mocked(getSetting).mockResolvedValue(JSON.stringify(config));
		vi.mocked(getServerIps).mockResolvedValue({ ipv4: '1.2.3.4', ipv6: null });
		const records = [
			{ type: 'A', name: 'risved.example.com', value: '1.2.3.4', purpose: 'Dashboard' }
		];
		vi.mocked(generateDnsRecords).mockReturnValue(records as never);
		vi.mocked(checkAllDnsRecords).mockResolvedValue([
			{ record: records[0] as never, resolved: true }
		]);

		const result = await actions.check(makeActionEvent('check'));
		expect(result).toMatchObject({ allResolved: true });
		expect(setSetting).toHaveBeenCalledWith('dns_verified', 'true');
	});
});

describe('verify skip action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to git without setting dns_verified', async () => {
		await expect(actions.skip(makeActionEvent('skip'))).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/git'
		});
		expect(setSetting).not.toHaveBeenCalled();
	});
});

describe('verify page source', () => {
	it('includes step indicator at step 2', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('StepIndicator');
		expect(mod.default).toContain('current={2}');
	});

	it('has DNS records display', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('dns-records');
		expect(mod.default).toContain('copy-btn');
	});

	it('has provider chips', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('Cloudflare');
		expect(mod.default).toContain('Namecheap');
		expect(mod.default).toContain('Route53');
	});

	it('has check DNS and actions', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('check-dns');
		expect(mod.default).toContain('check-actions');
	});

	it('has check and skip buttons', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('Check DNS');
		expect(mod.default).toContain('Skip for now');
	});
});
