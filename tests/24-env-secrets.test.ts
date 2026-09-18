import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Environment variable secrets', () => {
	const PROJECT_ID = 'env-secrets-proj-1';
	const SLUG = 'env-secrets-app';
	const STORED_SECRET = 'sk-stored-secret-value';

	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:test.db' });
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
			DELETE FROM projects;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@env-secrets-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		/* The remaining onboarding steps aren't under test here, so mark them done */
		const db = createClient({ url: 'file:test.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);
		await db.execute(
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, webhook_secret, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Env Secrets App', '${SLUG}', 'https://github.com/test/env-secrets', 'main', 'sveltekit', 'whsec_test', 3001, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		db.close();

		await page.close();
	});

	test.beforeEach(async () => {
		const db = createClient({ url: 'file:test.db' });
		await db.execute(`DELETE FROM env_vars WHERE project_id = '${PROJECT_ID}'`);
		await db.execute(
			`INSERT INTO env_vars (id, project_id, key, value, is_secret, created_at, updated_at) VALUES ('env-s-1', '${PROJECT_ID}', 'API_KEY', '${STORED_SECRET}', 1, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT INTO env_vars (id, project_id, key, value, is_secret, created_at, updated_at) VALUES ('env-s-2', '${PROJECT_ID}', 'NODE_ENV', 'production', 0, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		db.close();
	});

	async function loginAndGoToSettings(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@env-secrets-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/projects', { timeout: 15000 });
		await page.goto(`/projects/${SLUG}/settings`);
		await page.waitForLoadState('networkidle');
	}

	async function storedRows() {
		const db = createClient({ url: 'file:test.db' });
		const res = await db.execute(
			`SELECT id, key, value, is_secret FROM env_vars WHERE project_id = '${PROJECT_ID}' ORDER BY key`
		);
		db.close();
		return res.rows;
	}

	/** The test server's encryption key isn't available here, so compare ciphertext instead of plaintext */
	async function storedValue(key: string) {
		return (await storedRows()).find((r) => r.key === key)?.value as string | undefined;
	}

	test('a stored secret never reaches the browser, a plain variable does', async ({ page }) => {
		await loginAndGoToSettings(page);

		const rows = page.getByTestId('env-row');
		await expect(rows).toHaveCount(2);

		/* Secret row is locked: masked, disabled, with a Replace action */
		await expect(rows.nth(0).getByTestId('env-key-input')).toHaveValue('API_KEY');
		await expect(rows.nth(0).getByTestId('env-value-locked')).toBeDisabled();
		await expect(rows.nth(0).getByTestId('env-replace-btn')).toBeVisible();
		await expect(rows.nth(0).getByTestId('env-secret-checkbox')).toBeChecked();

		/* Plain row is readable and unticked */
		await expect(rows.nth(1).getByTestId('env-value-input')).toHaveValue('production');
		await expect(rows.nth(1).getByTestId('env-secret-checkbox')).not.toBeChecked();

		/* The secret is nowhere in the document or the serialized page data */
		expect(await page.content()).not.toContain(STORED_SECRET);

		await page.screenshot({ path: 'test-results/env-secrets-settings.png', fullPage: true });
	});

	test('the server-rendered HTML and data endpoint omit the secret', async ({ page }) => {
		await loginAndGoToSettings(page);

		const html = await page.request.get(`/projects/${SLUG}/settings`);
		expect(html.status()).toBe(200);
		const body = await html.text();
		expect(body).toContain('production');
		expect(body).not.toContain(STORED_SECRET);

		const dataRes = await page.request.get(`/projects/${SLUG}/settings/__data.json`);
		expect(await dataRes.text()).not.toContain(STORED_SECRET);

		const api = await page.request.get(`/api/projects/${PROJECT_ID}/env`);
		expect(api.status()).toBe(200);
		const vars = await api.json();
		expect(vars.find((v: { key: string }) => v.key === 'API_KEY').value).toBe('••••••••');
		expect(vars.find((v: { key: string }) => v.key === 'NODE_ENV').value).toBe('production');
	});

	test('saving without touching a secret keeps its stored value and id', async ({ page }) => {
		await loginAndGoToSettings(page);

		/* Change only the plain variable */
		await page.getByTestId('env-row').nth(1).getByTestId('env-value-input').fill('staging');
		await page.getByTestId('save-env-btn').click();
		await expect(page.getByTestId('redeploy-banner')).toBeVisible();

		const rows = await storedRows();
		expect(rows).toHaveLength(2);
		const secret = rows.find((r) => r.key === 'API_KEY');
		expect(secret?.id).toBe('env-s-1');
		expect(secret?.value).toBe(STORED_SECRET);
		expect(secret?.is_secret).toBe(1);

		/* Saving twice in a row must not lose the secret either */
		await page.getByTestId('save-env-btn').click();
		await page.waitForLoadState('networkidle');
		expect(await storedValue('API_KEY')).toBe(STORED_SECRET);
	});

	test('replacing a secret stores the new value and locks the row again', async ({ page }) => {
		await loginAndGoToSettings(page);

		const row = page.getByTestId('env-row').nth(0);
		await row.getByTestId('env-replace-btn').click();

		/* Keep current backs out of the replacement */
		await row.getByTestId('env-keep-btn').click();
		await expect(row.getByTestId('env-value-locked')).toBeVisible();

		await row.getByTestId('env-replace-btn').click();
		await row.getByTestId('env-value-input').fill('sk-brand-new');

		/* While typing, the value can be checked with View */
		await expect(row.getByTestId('env-value-input')).toHaveAttribute('type', 'password');
		await row.getByTestId('env-secret-toggle').click();
		await expect(row.getByTestId('env-value-input')).toHaveAttribute('type', 'text');

		await page.getByTestId('save-env-btn').click();
		await expect(page.getByTestId('redeploy-banner')).toBeVisible();

		/* Locked again, and the typed value is gone from the page */
		await expect(row.getByTestId('env-value-locked')).toBeVisible();
		expect(await page.content()).not.toContain('sk-brand-new');

		const value = await storedValue('API_KEY');
		expect(value).toBeTruthy();
		expect(value).not.toBe(STORED_SECRET);
		expect(value).not.toBe('sk-brand-new');
	});

	test('unticking Secret on a stored secret demands a new value instead of revealing it', async ({
		page
	}) => {
		await loginAndGoToSettings(page);

		const row = page.getByTestId('env-row').nth(0);
		await row.getByTestId('env-secret-checkbox').uncheck();

		/* The row opens for editing, empty */
		await expect(row.getByTestId('env-value-input')).toHaveValue('');
		expect(await page.content()).not.toContain(STORED_SECRET);

		await row.getByTestId('env-value-input').fill('now-plain');
		await page.getByTestId('save-env-btn').click();
		await expect(page.getByTestId('redeploy-banner')).toBeVisible();

		await expect(row.getByTestId('env-value-input')).toHaveValue('now-plain');
		await expect(row.getByTestId('env-secret-checkbox')).not.toBeChecked();
		const rows = await storedRows();
		expect(rows.find((r) => r.key === 'API_KEY')?.is_secret).toBe(0);
	});

	test('a forged request cannot turn a stored secret into a readable plain variable', async ({
		page
	}) => {
		await loginAndGoToSettings(page);

		const res = await page.request.put(`/api/projects/${PROJECT_ID}/env/env-s-1`, {
			data: { is_secret: false }
		});
		expect(res.status()).toBe(400);

		const form = await page.request.post(`/projects/${SLUG}/settings?/saveEnv`, {
			headers: { origin: new URL(page.url()).origin },
			form: {
				envIds: 'env-s-1',
				envKeys: 'API_KEY',
				envValues: '',
				envSecrets: '0',
				envKeep: '1'
			}
		});
		expect(await form.text()).toContain('Enter a new value');

		const rows = await storedRows();
		expect(rows).toHaveLength(2);
		const secret = rows.find((r) => r.key === 'API_KEY');
		expect(secret?.is_secret).toBe(1);
		expect(secret?.value).toBe(STORED_SECRET);
	});

	test('new variables default to secret on both settings and the new project page', async ({
		page
	}) => {
		await loginAndGoToSettings(page);

		await page.getByTestId('env-add-btn').click();
		const added = page.getByTestId('env-row').nth(2);
		await expect(added.getByTestId('env-secret-checkbox')).toBeChecked();
		await expect(added.getByTestId('env-value-input')).toHaveAttribute('type', 'password');

		/* Unticking makes it a readable plain variable */
		await added.getByTestId('env-secret-checkbox').uncheck();
		await expect(added.getByTestId('env-value-input')).toHaveAttribute('type', 'text');
		await expect(page.getByTestId('env-hint')).toContainText('write-only');

		await page.goto('/new');
		await page.waitForLoadState('networkidle');
		await page.getByTestId('env-add-btn').click();
		const newRow = page.getByTestId('env-row').first();
		await expect(newRow.getByTestId('env-secret-checkbox')).toBeChecked();
		await expect(newRow.getByTestId('env-value-input')).toHaveAttribute('type', 'password');
		await expect(page.getByTestId('env-hint')).toContainText('write-only');
		await page.screenshot({ path: 'test-results/env-secrets-new.png', fullPage: true });

		await newRow.getByTestId('env-secret-toggle').click();
		await expect(newRow.getByTestId('env-value-input')).toHaveAttribute('type', 'text');
		await newRow.getByTestId('env-secret-checkbox').uncheck();
		await expect(newRow.getByTestId('env-secret-toggle')).toHaveCount(0);
	});
});
