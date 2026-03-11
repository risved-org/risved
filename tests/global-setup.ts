import { createClient } from '@libsql/client';

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
	`);

	client.close();
}

export default globalSetup;
