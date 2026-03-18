import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Git Settings Screen', () => {
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
			DELETE FROM preview_deployments;
		`);
		client.close();

		const page = await browser.newPage();

		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@git-settings-test.com');
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
		await page.locator('input#email').fill('admin@git-settings-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows all sections', async ({ page }) => {
		await loginAndGo(page, '/settings/git');

		await expect(page.getByTestId('accounts-section')).toBeVisible();
		await expect(page.getByTestId('ssh-section')).toBeVisible();
		await expect(page.getByTestId('defaults-section')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-33-1.png',
			fullPage: true
		});
	});

	test('shows empty state for connections', async ({ page }) => {
		await loginAndGo(page, '/settings/git');

		await expect(page.getByTestId('no-connections')).toBeVisible();
		await expect(page.getByTestId('add-provider-link')).toBeVisible();
	});

	test('shows default webhook toggles', async ({ page }) => {
		await loginAndGo(page, '/settings/git');

		await expect(page.getByTestId('auto-webhook-toggle')).toBeVisible();
		await expect(page.getByTestId('commit-status-toggle')).toBeVisible();
		await expect(page.getByTestId('deploy-previews-toggle')).toBeVisible();
		await expect(page.getByTestId('save-defaults-btn')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-33-2.png',
			fullPage: true
		});
	});

	test('navigable from settings page', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('git-settings-link')).toBeVisible();
		const href = await page.getByTestId('git-settings-link').getAttribute('href');
		expect(href).toContain('/settings/git');
	});

	test('no console errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGo(page, '/settings/git');
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
