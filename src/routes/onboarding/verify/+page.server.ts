import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';
import {
	generateDnsRecords,
	checkAllDnsRecords,
	getServerIps,
	type DnsCheckResult
} from '$lib/server/dns';
import type { DomainConfig } from '../domain/+page.server';

export const load: PageServerLoad = async () => {
	const firstRun = await isFirstRun();
	if (firstRun) {
		redirect(303, '/onboarding');
	}

	const raw = await getSetting('domain_config');
	if (!raw) {
		redirect(303, '/onboarding/domain');
	}

	let config: DomainConfig;
	try {
		config = JSON.parse(raw);
	} catch {
		redirect(303, '/onboarding/domain');
	}

	if (config.mode === 'ip') {
		await setSetting('dns_verified', 'true');
		redirect(303, '/onboarding/git');
	}

	const serverIps = await getServerIps();
	const records = generateDnsRecords(config.mode, config.baseDomain, config.prefix, serverIps);
	const dnsVerified = (await getSetting('dns_verified')) === 'true';

	/* Surface the last DNS check so returning to this page shows prior results
	   instead of forcing a re-check */
	let lastCheck: { results: { name: string; type: string; resolved: boolean }[]; allResolved: boolean; checkedAt: string } | null = null;
	try {
		const raw = await getSetting('dns_check_results');
		if (raw) lastCheck = JSON.parse(raw);
	} catch {
		/* ignore corrupt data */
	}

	return {
		domainConfig: config,
		serverIps,
		records,
		dnsVerified,
		lastCheck
	};
};

export const actions: Actions = {
	check: async () => {
		const raw = await getSetting('domain_config');
		if (!raw) {
			redirect(303, '/onboarding/domain');
		}

		let config: DomainConfig;
		try {
			config = JSON.parse(raw);
		} catch {
			redirect(303, '/onboarding/domain');
		}

		const serverIps = await getServerIps();
		const records = generateDnsRecords(config.mode, config.baseDomain, config.prefix, serverIps);
		const results: DnsCheckResult[] = await checkAllDnsRecords(records);

		const allResolved = results.length > 0 && results.every((r) => r.resolved);

		if (allResolved) {
			await setSetting('dns_verified', 'true');
		}

		const summary = results.map((r) => ({
			name: r.record.name,
			type: r.record.type,
			resolved: r.resolved
		}));

		/* Persist so the results survive navigating away and back */
		await setSetting(
			'dns_check_results',
			JSON.stringify({ results: summary, allResolved, checkedAt: new Date().toISOString() })
		);

		return {
			results: summary,
			allResolved,
			serverIps
		};
	},

	skip: async () => {
		await setSetting('dns_verified', 'true')
		redirect(303, '/onboarding/git')
	}
};
