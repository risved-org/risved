import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Repo Picker Screen', () => {
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
			DELETE FROM git_connections;
		`);
		client.close();

		const page = await browser.newPage();

		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@repo-picker-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });
		await page.getByRole('button', { name: /skip/i }).click();
		await page.waitForURL('**/', { timeout: 60000 });

		const db = createClient({ url: 'file:test.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);
		db.close();

		await page.close();
	});

	async function loginAndGo(page: import('@playwright/test').Page, path: string) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@repo-picker-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows empty state when no providers connected', async ({ page }) => {
		await loginAndGo(page, '/new/import');

		await expect(page.getByTestId('no-providers')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-30-1.png',
			fullPage: true
		});
	});

	test('shows account selector when provider connected', async ({ page }) => {
		/* Seed a fake connection */
		const db = createClient({ url: 'file:test.db' });
		await db.execute(
			`INSERT OR REPLACE INTO git_connections (id, provider, account_name, access_token, avatar_url, created_at, updated_at)
			 VALUES ('conn-test-1', 'github', 'testuser', 'fake-token', '', datetime('now'), datetime('now'))`
		);
		db.close();

		await loginAndGo(page, '/new/import');

		await expect(page.getByTestId('account-selector')).toBeVisible();
		await expect(page.getByTestId('account-select')).toBeVisible();
		await expect(page.getByTestId('search-section')).toBeVisible();
		await expect(page.getByTestId('repo-search')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-30-2.png',
			fullPage: true
		});
	});

	test('search input is present', async ({ page }) => {
		await loginAndGo(page, '/new/import');
		await expect(page.getByTestId('repo-search')).toBeVisible();
		await expect(page.getByTestId('search-btn')).toBeVisible();
	});

	test('repo list section exists', async ({ page }) => {
		await loginAndGo(page, '/new/import');
		await expect(page.getByTestId('repo-list')).toBeVisible();
	});

	test('has back link to new project', async ({ page }) => {
		await loginAndGo(page, '/new/import');
		const backLink = page.locator('a.back-link');
		const href = await backLink.getAttribute('href');
		expect(href).toContain('/new');
	});

	test('no console errors on import page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGo(page, '/new/import');
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
