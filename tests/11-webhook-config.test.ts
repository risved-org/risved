import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Webhook Configuration UI', () => {
	const PROJECT_ID = 'webhook-cfg-proj-1';
	const SLUG = 'webhook-app';

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

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@webhook-cfg.com');
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
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, webhook_secret, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Webhook App', '${SLUG}', 'https://github.com/test/webhook', 'main', 'sveltekit', 'whsec_testconfigsecret123', 3001, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGoToWebhooks(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@webhook-cfg.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(`/projects/${SLUG}/webhooks`);
		await page.waitForLoadState('networkidle');
	}

	test('shows payload URL with copy button', async ({ page }) => {
		await loginAndGoToWebhooks(page);

		await expect(page.getByTestId('payload-url-section')).toBeVisible();
		const url = page.getByTestId('payload-url');
		await expect(url).toBeVisible();
		await expect(url).toContainText(`/api/webhooks/${PROJECT_ID}`);
		await expect(page.getByTestId('copy-url-btn')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-16-1.png', fullPage: true });
	});

	test('shows webhook secret with copy and regenerate', async ({ page }) => {
		await loginAndGoToWebhooks(page);

		await expect(page.getByTestId('secret-section')).toBeVisible();
		await expect(page.getByTestId('webhook-secret')).toContainText('whsec_testconfigsecret123');
		await expect(page.getByTestId('copy-secret-btn')).toBeVisible();
		await expect(page.getByTestId('regenerate-btn')).toBeVisible();
	});

	test('shows provider tabs with setup guides', async ({ page }) => {
		await loginAndGoToWebhooks(page);

		const tabs = page.getByTestId('provider-tabs');
		await expect(tabs).toBeVisible();

		/* GitHub tab active by default */
		await expect(page.getByTestId('guide-content')).toBeVisible();
		await expect(page.getByTestId('guide-content')).toContainText('Settings');

		/* Switch to GitLab */
		await tabs.getByText('GitLab').click();
		await expect(page.getByTestId('guide-content')).toContainText('Merge request events');

		/* Switch to Bitbucket */
		await tabs.getByText('Bitbucket').click();
		await expect(page.getByTestId('guide-content')).toContainText('Bitbucket');
	});

	test('shows branch filter and event toggles', async ({ page }) => {
		await loginAndGoToWebhooks(page);

		await expect(page.getByTestId('config-section')).toBeVisible();
		await expect(page.getByTestId('branch-input')).toBeVisible();
		await expect(page.getByTestId('branch-input')).toHaveValue('main');
		await expect(page.getByTestId('toggle-push')).toBeVisible();
		await expect(page.getByTestId('toggle-pr-merged')).toBeVisible();
		await expect(page.getByTestId('save-btn')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-16-2.png', fullPage: true });
	});

	test('can navigate from project detail to webhooks', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@webhook-cfg.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });

		await page.goto(`/projects/${SLUG}`);
		await page.waitForLoadState('networkidle');

		await page.getByTestId('configure-webhook-btn').click();
		await page.waitForURL(`**/projects/${SLUG}/webhooks`, { timeout: 10000 });
		await expect(page.getByTestId('payload-url-section')).toBeVisible();
	});

	test('no console errors on webhook config page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGoToWebhooks(page);

		expect(errors).toEqual([]);
	});
});
