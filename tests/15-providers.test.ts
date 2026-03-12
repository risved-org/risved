import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Connect Provider Screen', () => {
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
			DELETE FROM git_connections;
		`);
		client.close();

		const page = await browser.newPage();

		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@providers-test.com');
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
		await page.locator('input#email').fill('admin@providers-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows provider cards', async ({ page }) => {
		await loginAndGo(page, '/settings/providers');

		await expect(page.getByTestId('provider-cards')).toBeVisible();
		await expect(page.getByTestId('github-card')).toBeVisible();
		await expect(page.getByTestId('gitlab-card')).toBeVisible();
		await expect(page.getByTestId('forgejo-card')).toBeVisible();
		await expect(page.getByTestId('other-card')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-29-1.png',
			fullPage: true
		});
	});

	test('shows connect buttons on each card', async ({ page }) => {
		await loginAndGo(page, '/settings/providers');

		await expect(page.getByTestId('github-connect-btn')).toBeVisible();
		await expect(page.getByTestId('gitlab-connect-btn')).toBeVisible();
		await expect(page.getByTestId('forgejo-connect-btn')).toBeVisible();
		await expect(page.getByTestId('other-connect-btn')).toBeVisible();
	});

	test('shows forgejo connect form when clicking connect', async ({ page }) => {
		await loginAndGo(page, '/settings/providers');

		await page.getByTestId('forgejo-connect-btn').click();
		await expect(page.getByTestId('forgejo-form')).toBeVisible();
		await expect(page.getByTestId('forgejo-url-input')).toBeVisible();
		await expect(page.getByTestId('forgejo-token-input')).toBeVisible();
		await expect(page.getByTestId('forgejo-submit-btn')).toBeVisible();

		await page.screenshot({
			path: '.agent/screenshots/TASK-29-2.png',
			fullPage: true
		});
	});

	test('shows empty connected accounts initially', async ({ page }) => {
		await loginAndGo(page, '/settings/providers');

		await expect(page.getByTestId('connected-accounts')).toBeVisible();
		await expect(page.getByTestId('no-connections')).toBeVisible();
	});

	test('other provider links to manual setup', async ({ page }) => {
		await loginAndGo(page, '/settings/providers');

		const otherBtn = page.getByTestId('other-connect-btn');
		const href = await otherBtn.getAttribute('href');
		expect(href).toContain('/new');
	});

	test('no console errors on providers page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGo(page, '/settings/providers');
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
