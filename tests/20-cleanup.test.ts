import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Build Log Retention & Docker Prune', () => {
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

		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@cleanup-test.com');
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
		await page.locator('input#email').fill('admin@cleanup-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows retention section with default 30 days', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('retention-section')).toBeVisible();
		await expect(page.getByTestId('retention-input')).toBeVisible();

		const value = await page.getByTestId('retention-input').inputValue();
		expect(value).toBe('30');
	});

	test('can save retention setting', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await page.getByTestId('retention-input').fill('14');
		await page.getByTestId('save-retention-btn').click();
		await expect(page.getByTestId('retention-saved')).toBeVisible({ timeout: 10000 });
	});

	test('shows Docker resources section with prune buttons', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('docker-section')).toBeVisible();
		await expect(page.getByTestId('load-disk-btn')).toBeVisible();
		await expect(page.getByTestId('prune-images-btn')).toBeVisible();
		await expect(page.getByTestId('prune-containers-btn')).toBeVisible();
		await expect(page.getByTestId('prune-volumes-btn')).toBeVisible();
		await expect(page.getByTestId('prune-all-btn')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-38-1.png',
			fullPage: true
		});
	});

	test('run cleanup button exists', async ({ page }) => {
		await loginAndGo(page, '/settings');

		await expect(page.getByTestId('run-cleanup-btn')).toBeVisible();
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
