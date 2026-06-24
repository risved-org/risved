import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';

type DomainConfig = {
	mode?: string;
	baseDomain?: string;
	prefix?: string;
};

function getDashboardUrl(domainConfig: string | null): string {
	if (!domainConfig) return '';

	try {
		const domain = JSON.parse(domainConfig) as DomainConfig;
		if (domain.mode === 'subdomain' && domain.baseDomain && domain.prefix) {
			return `https://${domain.prefix}.${domain.baseDomain}`;
		}
		if (domain.mode === 'dedicated' && domain.baseDomain) {
			return `https://${domain.baseDomain}`;
		}
		if (domain.mode === 'ip' && domain.baseDomain) {
			return `http://${domain.baseDomain}`;
		}
	} catch {
		/* ignore corrupt data */
	}

	return '';
}

export const load: PageServerLoad = async () => {
	const firstRun = await isFirstRun();
	if (firstRun) {
		redirect(303, '/onboarding');
	}

	const deployConfig = await getSetting('first_deploy');
	if (!deployConfig) {
		redirect(303, '/onboarding/deploy');
	}

	const parsed = JSON.parse(deployConfig);
	const domainConfig = await getSetting('domain_config');
	let appUrl = '';

	if (domainConfig) {
		const domain = JSON.parse(domainConfig);
		if (domain.mode === 'subdomain') {
			appUrl = `https://${parsed.templateId ?? 'app'}.${domain.prefix ?? 'custom'}.${domain.baseDomain}`;
		} else if (domain.mode === 'dedicated') {
			appUrl = `https://${domain.baseDomain}`;
		} else if (domain.mode === 'ip' && domain.baseDomain) {
			appUrl = `http://${domain.baseDomain}`;
		}
	}

	return {
		deployType: parsed.type as 'starter' | 'repo',
		templateId: parsed.templateId ?? null,
		repoUrl: parsed.repoUrl ?? null,
		appUrl
	};
};

export const actions: Actions = {
	dashboard: async () => {
		await setSetting('onboarding_complete', 'true');

		const dnsVerified = (await getSetting('dns_verified')) === 'true';
		const dnsSkipped = (await getSetting('dns_verification_skipped')) === 'true';
		const dashboardUrl =
			dnsVerified && !dnsSkipped ? getDashboardUrl(await getSetting('domain_config')) : '';
		redirect(303, dashboardUrl || '/');
	}
};
