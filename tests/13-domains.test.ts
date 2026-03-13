import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Domains Screen', () => {
	const PROJECT_ID = 'domains-proj-1';
	const SLUG = 'domains-app';
	const DOMAIN_ID = 'dom-test-001';

	test.beforeAll(async ({ browser }) => {
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
			DELETE FROM projects;
		`);
		client.close();

		const page = await browser.newPage();

		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@domains-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });
		await page.getByRole('button', { name: /skip/i }).click();
		await page.waitForURL('**/', { timeout: 60000 });

		/* Seed test data */
		const db = createClient({ url: 'file:local.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);
		await db.execute(
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, webhook_secret, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Domains App', '${SLUG}', 'https://github.com/test/domains', 'main', 'sveltekit', 'whsec_domsecret123', 3001, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO domains (id, project_id, hostname, is_primary, ssl_status, verified_at, created_at) VALUES ('${DOMAIN_ID}', '${PROJECT_ID}', 'app.example.com', 1, 'active', '2026-03-11T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO domains (id, project_id, hostname, is_primary, ssl_status, created_at) VALUES ('dom-test-002', '${PROJECT_ID}', 'staging.example.com', 0, 'pending', '2026-03-10T00:00:00Z')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGo(page: import('@playwright/test').Page, path: string) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@domains-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows domain list with rows', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/domains`);

		await expect(page.getByTestId('domains-list')).toBeVisible();
		await expect(page.getByTestId('domain-table')).toBeVisible();
		const rows = page.getByTestId('domain-row');
		await expect(rows).toHaveCount(2);

		await expect(rows.first().getByTestId('domain-hostname')).toContainText('app.example.com');
		await expect(rows.first().getByTestId('ssl-status')).toContainText('Active');

		await page.screenshot({
			path: '.agent/screenshots/TASK-24-1.png',
			fullPage: true
		});
	});

	test('shows add domain form with DNS instructions', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/domains`);

		await page.getByTestId('add-domain-btn').click();
		await expect(page.getByTestId('add-domain-section')).toBeVisible();
		await expect(page.getByTestId('hostname-input')).toBeVisible();
		await expect(page.getByTestId('dns-instructions')).toBeVisible();
		await expect(page.getByTestId('dns-record')).toBeVisible();
		await expect(page.getByTestId('server-ip')).toBeVisible();
		await expect(page.getByTestId('routing-diagram')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-24-2.png',
			fullPage: true
		});
	});

	test('can navigate from project detail to domains', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}`);

		await page.getByTestId('manage-domains-btn').click();
		await page.waitForURL(`**/projects/${SLUG}/domains`, { timeout: 10000 });
		await expect(page.getByTestId('domains-list')).toBeVisible();
	});

	test('shows check DNS and remove buttons', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/domains`);

		await expect(page.getByTestId('check-dns-btn').first()).toBeVisible();
		await expect(page.getByTestId('remove-domain-btn').first()).toBeVisible();
	});

	test('shows set primary button for non-primary domain', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/domains`);

		const nonPrimaryRow = page.getByTestId('domain-row').nth(1);
		await expect(nonPrimaryRow.getByTestId('set-primary-btn')).toBeVisible();
	});

	test('no console errors on domains page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGo(page, `/projects/${SLUG}/domains`);
		await page.getByTestId('add-domain-btn').click();
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
