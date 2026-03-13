import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Login Screen', () => {
	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:local.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM user;
			DELETE FROM settings;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@login-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		/* Set IP mode and skip deploy */
		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });
		await page.getByRole('button', { name: /skip/i }).click();
		await page.waitForURL('**/', { timeout: 60000 });

		/* Mark onboarding complete */
		const db = createClient({ url: 'file:local.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);
		db.close();

		/* Clear session so we land on login */
		const db2 = createClient({ url: 'file:local.db' });
		await db2.execute('DELETE FROM session');
		db2.close();

		await page.close();
	});

	test('shows login form with RISVED wordmark', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		await expect(page.locator('.wordmark')).toHaveText('RISVED');
		await expect(page.locator('input#email')).toBeVisible();
		await expect(page.locator('input#password')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-19-1.png', fullPage: true });
	});

	test('shows forgot password CLI reference', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		await expect(page.locator('.forgot')).toContainText('risved reset-password');
	});

	test('shows status footer with health dot', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		await expect(page.locator('.status-footer')).toBeVisible();
		await expect(page.locator('.health-dot')).toBeVisible();
	});

	test('redirects unauthenticated users to login', async ({ page }) => {
		/* Clear session */
		const db = createClient({ url: 'file:local.db' });
		await db.execute('DELETE FROM session');
		db.close();

		await page.goto('/');
		await page.waitForURL('**/login', { timeout: 15000 });
	});

	test('shows error on invalid credentials', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		await page.locator('input#email').fill('admin@login-test.com');
		await page.locator('input#password').fill('wrongpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();

		await expect(page.locator('.form-error')).toBeVisible({ timeout: 10000 });

		await page.screenshot({ path: '.agent/screenshots/TASK-19-2.png', fullPage: true });
	});

	test('no console errors on page load', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	});
});
