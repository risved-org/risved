import { fail, redirect } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { auth } from '$lib/server/auth'
import { isFirstRun } from '$lib/server/auth-utils'
import { setSetting } from '$lib/server/settings'
import { APIError } from 'better-auth/api'

export const load: PageServerLoad = async () => {
	const firstRun = await isFirstRun();
	if (!firstRun) {
		redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString()?.trim() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

		if (!email) {
			return fail(400, { email, error: 'Email is required.' });
		}

		if (password.length < 8) {
			return fail(400, { email, error: 'Password must be at least 8 characters.' });
		}

		if (password !== confirmPassword) {
			return fail(400, { email, error: 'Passwords do not match.' });
		}

		const firstRun = await isFirstRun();
		if (!firstRun) {
			return fail(403, { email, error: 'Admin account already exists.' });
		}

		/* Reset onboarding flag so the remaining steps are accessible */
		await setSetting('onboarding_complete', 'false')

		try {
			await auth.api.signUpEmail({
				body: { email, password, name: 'Admin' },
				headers: event.request.headers
			})
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { email, error: error.message || 'Account creation failed.' });
			}
			return fail(500, { email, error: 'An unexpected error occurred.' });
		}

		redirect(303, '/onboarding/domain');
	}
};
