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

	return {
		domainConfig: config,
		serverIps,
		records,
		dnsVerified
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

		return {
			results: results.map((r) => ({
				name: r.record.name,
				type: r.record.type,
				resolved: r.resolved
			})),
			allResolved,
			serverIps
		};
	},

	skip: async () => {
		await setSetting('dns_verified', 'true');
		redirect(303, '/onboarding/git');
	}
};
