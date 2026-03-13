import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Passkey Authentication', () => {
	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:local.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM passkey;
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
		await page.locator('input#email').fill('admin@passkey-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });
		await page.getByRole('button', { name: /skip/i }).click();
		await page.waitForURL('**/', { timeout: 60000 });

		const db = createClient({ url: 'file:local.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);
		db.close();

		await page.close();
	});

	async function loginAndGo(page: import('@playwright/test').Page, path: string) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@passkey-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('login page shows passkey sign-in button', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		await expect(page.getByTestId('passkey-login-btn')).toBeVisible();
		await expect(page.getByText('or', { exact: true })).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-39-1.png',
			fullPage: true
		});
	});

	test('settings page shows passkey section', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('passkey-section')).toBeVisible();
		await expect(page.getByTestId('register-passkey-btn')).toBeVisible();
		await expect(page.getByTestId('passkey-name-input')).toBeVisible();
		await expect(page.getByTestId('no-passkeys')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-39-2.png',
			fullPage: true
		});
	});

	test('settings page has refresh passkeys button', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('refresh-passkeys-btn')).toBeVisible();
	});

	test('no console errors on login page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});

	test('no console errors on settings page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGo(page, '/settings');
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
