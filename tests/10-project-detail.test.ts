import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Project Detail Screen', () => {
	const PROJECT_ID = 'detail-proj-1';
	const SLUG = 'detail-app';

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
		await page.locator('input#email').fill('admin@detail-test.com');
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
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, webhook_secret, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Detail App', '${SLUG}', 'https://github.com/test/detail', 'main', 'sveltekit', 'whsec_test', 3001, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, created_at) VALUES ('dep-detail-1', '${PROJECT_ID}', 'abc1234567890', 'live', '2026-03-11T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, created_at) VALUES ('dep-detail-2', '${PROJECT_ID}', 'def5678901234', 'failed', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO env_vars (id, project_id, key, value, is_secret, created_at, updated_at) VALUES ('env-1', '${PROJECT_ID}', 'API_KEY', 'sk-test123', 1, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO env_vars (id, project_id, key, value, is_secret, created_at, updated_at) VALUES ('env-2', '${PROJECT_ID}', 'NODE_ENV', 'production', 0, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO domains (id, project_id, hostname, is_primary, ssl_status, created_at) VALUES ('dom-1', '${PROJECT_ID}', 'detail.example.com', 1, 'active', '2026-03-10T00:00:00Z')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGoToProject(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@detail-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(`/projects/${SLUG}`);
		await page.waitForLoadState('networkidle');
	}

	test('shows project header with name and framework', async ({ page }) => {
		await loginAndGoToProject(page);

		await expect(page.getByTestId('project-header')).toBeVisible();
		await expect(page.getByText('Detail App')).toBeVisible();
		await expect(page.locator('.framework-badge').getByText('SvelteKit')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-23-1.png', fullPage: true });
	});

	test('shows deployments with commit SHAs', async ({ page }) => {
		await loginAndGoToProject(page);

		await expect(page.getByTestId('deployments-section')).toBeVisible();
		const rows = page.getByTestId('deploy-row');
		await expect(rows.first()).toBeVisible();
		await expect(page.getByText('abc1234')).toBeVisible();
	});

	test('shows webhook section', async ({ page }) => {
		await loginAndGoToProject(page);

		await expect(page.getByTestId('webhook-section')).toBeVisible();
		await expect(page.getByText('Webhook active')).toBeVisible();
	});

	test('shows environment variables with masked secrets', async ({ page }) => {
		await loginAndGoToProject(page);

		await expect(page.getByTestId('env-section')).toBeVisible();
		await expect(page.getByText('API_KEY')).toBeVisible();
		await expect(page.getByText('NODE_ENV')).toBeVisible();
		await expect(page.getByText('production')).toBeVisible();
		/* Secret should be masked */
		await expect(page.getByText('sk-t••••••••')).toBeVisible();
	});

	test('shows domains section with SSL status', async ({ page }) => {
		await loginAndGoToProject(page);

		const section = page.getByTestId('domains-section');
		await expect(section).toBeVisible();
		await expect(page.getByTestId('domain-row')).toBeVisible();
		await expect(section.getByText('Primary')).toBeVisible();
	});

	test('shows danger zone with delete button', async ({ page }) => {
		await loginAndGoToProject(page);

		await expect(page.getByTestId('danger-zone')).toBeVisible();
		await expect(page.getByTestId('delete-btn')).toBeVisible();

		/* Click delete shows confirmation */
		await page.getByTestId('delete-btn').click();
		await expect(page.getByTestId('confirm-delete-btn')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-23-2.png', fullPage: true });
	});

	test('no console errors on project detail page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGoToProject(page);

		expect(errors).toEqual([]);
	});
});
