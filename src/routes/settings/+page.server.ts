import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user as userTable, gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting, setSetting } from '$lib/server/settings';
import { auth } from '$lib/server/auth';
import { getUpdateChecker } from '$lib/server/update';
import { getCensusReporter } from '$lib/server/census';
import { getHeartbeatReporter } from '$lib/server/heartbeat';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		return { user: null, hostname: null, timezone: null, apiToken: null, retentionDays: 30, connections: [] };
	}

	const hostname = await getSetting('hostname');
	const timezone = await getSetting('timezone');
	const apiToken = await getSetting('api_token');
	const retentionSetting = await getSetting('log_retention_days');
	const retentionDays = retentionSetting ? parseInt(retentionSetting, 10) : 30;

	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName
		})
		.from(gitConnections);

	const updateInfo = await getUpdateChecker().getCachedUpdateInfo();
	const censusInfo = await getCensusReporter().getInfo();
	const heartbeatInfo = await getHeartbeatReporter().getInfo();

	return {
		user: {
			id: currentUser.id,
			email: currentUser.email,
			name: currentUser.name
		},
		hostname: hostname ?? '',
		timezone: timezone ?? '',
		apiToken: apiToken ? maskToken(apiToken) : null,
		retentionDays: isNaN(retentionDays) ? 30 : retentionDays,
		connections,
		updateInfo,
		censusInfo,
		heartbeatInfo
	};
};

/** Show first 8 and last 4 chars of a token. */
function maskToken(token: string): string {
	if (token.length <= 12) return '••••••••';
	return token.slice(0, 8) + '••••' + token.slice(-4);
}

export const actions: Actions = {
	/** Update general settings (hostname, timezone). */
	general: async ({ request }) => {
		const formData = await request.formData();
		const hostname = (formData.get('hostname') as string)?.trim() ?? '';
		const timezone = (formData.get('timezone') as string)?.trim() ?? 'UTC';

		if (hostname) {
			await setSetting('hostname', hostname);
		}
		await setSetting('timezone', timezone);

		return { generalSaved: true };
	},

	/** Update admin email. */
	email: async ({ request, locals }) => {
		const formData = await request.formData();
		const newEmail = (formData.get('email') as string)?.trim();

		if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
			return fail(400, { emailError: 'Invalid email address' });
		}

		const userId = locals.user?.id;
		if (!userId) {
			return fail(401, { emailError: 'Not authenticated' });
		}

		await db.update(userTable).set({ email: newEmail }).where(eq(userTable.id, userId));

		return { emailSaved: true };
	},

	/** Change password via BetterAuth. */
	password: async ({ request }) => {
		const formData = await request.formData();
		const currentPassword = formData.get('currentPassword') as string;
		const newPassword = formData.get('newPassword') as string;
		const confirmPassword = formData.get('confirmPassword') as string;

		if (!currentPassword) {
			return fail(400, { passwordError: 'Current password is required' });
		}
		if (!newPassword || newPassword.length < 8) {
			return fail(400, { passwordError: 'New password must be at least 8 characters' });
		}
		if (newPassword !== confirmPassword) {
			return fail(400, { passwordError: 'Passwords do not match' });
		}

		try {
			await auth.api.changePassword({
				body: {
					currentPassword,
					newPassword
				}
			});
		} catch {
			return fail(400, { passwordError: 'Current password is incorrect' });
		}

		return { passwordChanged: true };
	},

	/** Generate a new API token. */
	generateToken: async () => {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = 'rsv_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

		await setSetting('api_token', token);

		return { tokenGenerated: true, newToken: token };
	},

	/** Revoke the API token. */
	revokeToken: async () => {
		await setSetting('api_token', '');

		return { tokenRevoked: true };
	},

	/** Update build log retention period. */
	retention: async ({ request }) => {
		const formData = await request.formData();
		const days = parseInt((formData.get('retentionDays') as string) ?? '30', 10);

		if (isNaN(days) || days < 1 || days > 365) {
			return fail(400, { retentionError: 'Retention must be between 1 and 365 days' });
		}

		await setSetting('log_retention_days', String(days));
		return { retentionSaved: true };
	},

	/** Toggle operational heartbeat reporting. */
	heartbeat: async ({ request }) => {
		const formData = await request.formData();
		const enabled = formData.get('enabled') === 'true';
		await getHeartbeatReporter().setEnabled(enabled);
		return { heartbeatSaved: true };
	}
};
