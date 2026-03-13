import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Settings Screen', () => {
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
		await page.locator('input#email').fill('admin@settings-test.com');
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
		await page.locator('input#email').fill('admin@settings-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows general settings section', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('general-section')).toBeVisible();
		await expect(page.getByTestId('hostname-input')).toBeVisible();
		await expect(page.getByTestId('timezone-select')).toBeVisible();
		await expect(page.getByTestId('save-general-btn')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-25-1.png',
			fullPage: true
		});
	});

	test('shows email and password sections', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('email-section')).toBeVisible();
		await expect(page.getByTestId('email-input')).toBeVisible();
		await expect(page.getByTestId('password-section')).toBeVisible();
		await expect(page.getByTestId('current-password-input')).toBeVisible();
		await expect(page.getByTestId('new-password-input')).toBeVisible();
		await expect(page.getByTestId('confirm-password-input')).toBeVisible();
	});

	test('shows API token section', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('token-section')).toBeVisible();
		await expect(page.getByTestId('generate-token-btn')).toBeVisible();
		await expect(page.getByTestId('no-token')).toBeVisible();
	});

	test('can generate API token', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await page.getByTestId('generate-token-btn').click();
		await expect(page.getByTestId('new-token-display')).toBeVisible({ timeout: 10000 });
		await expect(page.getByTestId('token-value')).toBeVisible();

		const tokenText = await page.getByTestId('token-value').textContent();
		expect(tokenText).toMatch(/^rsv_/);

		await expect(page.getByTestId('copy-token-btn')).toBeVisible();
		await expect(page.getByTestId('revoke-token-btn')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-25-2.png',
			fullPage: true
		});
	});

	test('can save general settings', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await page.getByTestId('hostname-input').fill('risved.example.com');
		await page.getByTestId('save-general-btn').click();
		await expect(page.getByTestId('general-saved')).toBeVisible({ timeout: 10000 });
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
