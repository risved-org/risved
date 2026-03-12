import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';

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
			appUrl = `https://${parsed.templateId ?? 'app'}.${domain.prefix ?? 'risved'}.${domain.baseDomain}`;
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
		redirect(303, '/');
	}
};
