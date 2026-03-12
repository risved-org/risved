import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting, setSetting } from '$lib/server/settings';
import type { PageServerLoad, Actions } from './$types';

/** Default instance URLs per provider. */
const DEFAULT_INSTANCE_URLS: Record<string, string> = {
	github: 'https://github.com',
	gitlab: 'https://gitlab.com'
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { connections: [], sshPublicKey: null, defaults: defaultWebhookSettings() };
	}

	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			instanceUrl: gitConnections.instanceUrl,
			avatarUrl: gitConnections.avatarUrl,
			createdAt: gitConnections.createdAt
		})
		.from(gitConnections);

	const enriched = connections.map((c) => ({
		...c,
		instanceUrl: c.instanceUrl || DEFAULT_INSTANCE_URLS[c.provider] || null
	}));

	const sshPublicKey = await getSetting('ssh_deploy_public_key');

	const autoWebhook = await getSetting('git_auto_webhook');
	const commitStatus = await getSetting('git_commit_status');
	const deployPreviews = await getSetting('git_deploy_previews');

	return {
		connections: enriched,
		sshPublicKey,
		defaults: {
			autoWebhook: autoWebhook !== 'false',
			commitStatus: commitStatus !== 'false',
			deployPreviews: deployPreviews !== 'false'
		}
	};
};

function defaultWebhookSettings() {
	return { autoWebhook: true, commitStatus: true, deployPreviews: true };
}

export const actions: Actions = {
	/** Disconnect a provider connection. */
	disconnect: async ({ request }) => {
		const formData = await request.formData();
		const connectionId = formData.get('connectionId') as string;

		if (!connectionId) {
			return fail(400, { disconnectError: 'Connection ID required' });
		}

		await db.delete(gitConnections).where(eq(gitConnections.id, connectionId));

		return { disconnected: true };
	},

	/** Refresh repos for a connection (placeholder — triggers UI feedback). */
	refresh: async ({ request }) => {
		const formData = await request.formData();
		const connectionId = formData.get('connectionId') as string;

		if (!connectionId) {
			return fail(400, { refreshError: 'Connection ID required' });
		}

		/* Update the updatedAt timestamp to mark a "refresh". */
		await db
			.update(gitConnections)
			.set({ updatedAt: new Date().toISOString() })
			.where(eq(gitConnections.id, connectionId));

		return { refreshed: true, connectionId };
	},

	/** Generate an SSH deploy key pair for read-only repository access. */
	generateSshKey: async () => {
		const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' } as EcKeyGenParams, true, [
			'sign',
			'verify'
		]);

		const publicRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
		const publicBytes = new Uint8Array(publicRaw);
		const publicB64 = btoa(String.fromCharCode(...publicBytes));
		const publicKeyStr = `ssh-ed25519 ${publicB64} risved-deploy-key`;

		const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
		const privateB64 = btoa(String.fromCharCode(...new Uint8Array(privatePkcs8)));

		await setSetting('ssh_deploy_public_key', publicKeyStr);
		await setSetting('ssh_deploy_private_key', privateB64);

		return { keyGenerated: true };
	},

	/** Save default webhook settings. */
	saveDefaults: async ({ request }) => {
		const formData = await request.formData();

		const autoWebhook = formData.get('autoWebhook') === 'on';
		const commitStatus = formData.get('commitStatus') === 'on';
		const deployPreviews = formData.get('deployPreviews') === 'on';

		await setSetting('git_auto_webhook', String(autoWebhook));
		await setSetting('git_commit_status', String(commitStatus));
		await setSetting('git_deploy_previews', String(deployPreviews));

		return { defaultsSaved: true };
	}
};
