import { createClient } from '@libsql/client';

/**
 * Polls the dev server until SvelteKit routes return non-500 responses.
 * Vite's client endpoint returns 200 before SvelteKit proxy types are generated,
 * so we check an actual page route to ensure the server is truly ready.
 */
async function waitForServerReady(baseUrl: string, maxWaitMs = 90000) {
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		try {
			const res = await fetch(`${baseUrl}/onboarding`, { redirect: 'follow' });
			if (res.status !== 500) return;
		} catch {
			/* server not up yet */
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
}

/**
 * Resets the database to a clean state before e2e tests.
 * This ensures tests start from a first-run state.
 */
async function globalSetup() {
	const client = createClient({ url: 'file:local.db' });

	await client.executeMultiple(`
		DELETE FROM session;
		DELETE FROM account;
		DELETE FROM verification;
		DELETE FROM user;
		DELETE FROM settings;
		DELETE FROM build_logs;
		DELETE FROM webhook_deliveries;
		DELETE FROM env_vars;
		DELETE FROM deployments;
		DELETE FROM domains;
		DELETE FROM preview_deployments;
		DELETE FROM git_connections;
		DELETE FROM projects;
	`);

	client.close();

	/* Wait for SvelteKit types to be generated before tests start */
	await waitForServerReady('http://localhost:5173');
}

export default globalSetup;
