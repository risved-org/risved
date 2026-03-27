import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';
import { ensureControlPlaneRoutes } from '$lib/server/caddy/control-plane';

export type DomainMode = 'subdomain' | 'dedicated' | 'ip';

export interface DomainConfig {
	mode: DomainMode;
	baseDomain: string;
	prefix: string;
}

export const load: PageServerLoad = async () => {
	const firstRun = await isFirstRun();
	if (firstRun) {
		redirect(303, '/onboarding');
	}

	const existing = await getSetting('domain_config');
	if (existing) {
		try {
			return { domainConfig: JSON.parse(existing) as DomainConfig };
		} catch {
			/* ignore corrupt data */
		}
	}
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const mode = formData.get('mode')?.toString() as DomainMode | undefined;
		const baseDomain = formData.get('baseDomain')?.toString()?.trim() ?? '';
		const prefix = formData.get('prefix')?.toString()?.trim() ?? '';

		if (!mode || !['subdomain', 'dedicated', 'ip'].includes(mode)) {
			return fail(400, { error: 'Please select a domain configuration mode.' });
		}

		if (mode === 'subdomain') {
			if (!baseDomain) {
				return fail(400, { mode, baseDomain, prefix, error: 'Base domain is required.' });
			}
			if (!prefix) {
				return fail(400, { mode, baseDomain, prefix, error: 'Subdomain prefix is required.' });
			}
		}

		if (mode === 'dedicated') {
			if (!baseDomain) {
				return fail(400, { mode, baseDomain, prefix, error: 'Domain is required.' });
			}
		}

		const config: DomainConfig = { mode, baseDomain, prefix };
		await setSetting('domain_config', JSON.stringify(config));

		const hostname = mode === 'subdomain' ? `${prefix}.${baseDomain}` : baseDomain
		if (hostname) {
			await setSetting('hostname', hostname)
		}

		ensureControlPlaneRoutes().catch(e => console.error('[caddy] Route setup failed:', e))

		redirect(303, '/onboarding/verify');
	}
};
