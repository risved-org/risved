import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';
import { STARTER_TEMPLATES } from './templates';

export const load: PageServerLoad = async () => {
	const firstRun = await isFirstRun();
	if (firstRun) {
		redirect(303, '/onboarding');
	}

	const dnsVerified = await getSetting('dns_verified');
	if (dnsVerified !== 'true') {
		const domainConfig = await getSetting('domain_config');
		if (!domainConfig) {
			redirect(303, '/onboarding/domain');
		}
		redirect(303, '/onboarding/verify');
	}

	return {
		templates: STARTER_TEMPLATES
	};
};

export const actions: Actions = {
	starter: async ({ request }) => {
		const data = await request.formData();
		const templateId = data.get('templateId')?.toString();

		if (!templateId) {
			return fail(400, { error: 'Please select a starter template.' });
		}

		const template = STARTER_TEMPLATES.find((t) => t.id === templateId);
		if (!template) {
			return fail(400, { error: 'Invalid template selected.' });
		}

		await setSetting(
			'first_deploy',
			JSON.stringify({
				type: 'starter',
				templateId: template.id,
				repoUrl: template.repoUrl,
				framework: template.framework
			})
		);
		redirect(303, '/onboarding/success');
	},

	repo: async ({ request }) => {
		const data = await request.formData();
		const repoUrl = data.get('repoUrl')?.toString()?.trim();
		const branch = data.get('branch')?.toString()?.trim() || 'main';

		if (!repoUrl) {
			return fail(400, { error: 'Please enter a Git repository URL.', repoUrl: '', branch });
		}

		const gitUrlPattern = /^(https?:\/\/.+\.git|git@.+:.+\.git|https?:\/\/[^/]+\/.+\/.+)$/;
		if (!gitUrlPattern.test(repoUrl)) {
			return fail(400, {
				error: 'Please enter a valid Git URL (HTTPS or SSH).',
				repoUrl,
				branch
			});
		}

		await setSetting(
			'first_deploy',
			JSON.stringify({
				type: 'repo',
				repoUrl,
				branch
			})
		);
		redirect(303, '/onboarding/success');
	},

	skip: async () => {
		await setSetting('onboarding_complete', 'true');
		redirect(303, '/');
	}
};
