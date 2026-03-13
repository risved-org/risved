import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('PR Status Checks Configuration', () => {
	const PROJECT_ID = 'checks-cfg-proj-1';
	const SLUG = 'checks-app';

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
			DELETE FROM preview_deployments;
			DELETE FROM projects;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@checks-cfg.com');
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
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('domain', 'risved.test.com')"
		);
		await db.execute(
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, port, previews_enabled, preview_limit, preview_auto_delete, commit_status_enabled, required_check, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Checks App', '${SLUG}', 'https://github.com/test/checks', 'main', 'sveltekit', 3001, 0, 3, 1, 0, 0, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGoToChecks(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@checks-cfg.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(`/projects/${SLUG}/checks`);
		await page.waitForLoadState('networkidle');
	}

	test('shows commit status mock and preview URL', async ({ page }) => {
		await loginAndGoToChecks(page);

		await expect(page.getByTestId('status-check-mock')).toBeVisible();
		await expect(page.getByText('risved/deploy-preview')).toBeVisible();
		await expect(page.getByText('risved/build')).toBeVisible();

		await expect(page.getByTestId('url-format-section')).toBeVisible();
		await expect(page.getByTestId('preview-url-format')).toContainText(
			`pr-{number}.${SLUG}.risved.test.com`
		);

		await page.screenshot({ path: '.agent/screenshots/TASK-32-1.png', fullPage: true });
	});

	test('shows all four toggles and preview limit', async ({ page }) => {
		await loginAndGoToChecks(page);

		await expect(page.getByTestId('toggle-commit-status')).toBeVisible();
		await expect(page.getByTestId('toggle-previews')).toBeVisible();
		await expect(page.getByTestId('toggle-auto-delete')).toBeVisible();
		await expect(page.getByTestId('toggle-required-check')).toBeVisible();
		await expect(page.getByTestId('preview-limit-input')).toBeVisible();
		await expect(page.getByTestId('save-btn')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-32-2.png', fullPage: true });
	});

	test('can navigate from project detail to checks', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@checks-cfg.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });

		await page.goto(`/projects/${SLUG}`);
		await page.waitForLoadState('networkidle');

		await page.getByTestId('configure-checks-btn').click();
		await page.waitForURL(`**/projects/${SLUG}/checks`, { timeout: 10000 });
		await expect(page.getByTestId('status-check-mock')).toBeVisible();
	});

	test('no console errors on checks page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGoToChecks(page);

		expect(errors).toEqual([]);
	});
});
