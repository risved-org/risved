import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Dashboard Screen', () => {
	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:local.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM user;
			DELETE FROM settings;
			DELETE FROM deployments;
			DELETE FROM projects;
			DELETE FROM domains;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@dashboard-test.com');
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

		await page.close();
	});

	test('shows health bar with system metrics', async ({ page }) => {
		/* Login first */
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@dashboard-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });

		await expect(page.getByTestId('health-bar')).toBeVisible();
		await expect(page.getByTestId('cpu-value')).toBeVisible();
		await expect(page.getByTestId('mem-value')).toBeVisible();
		await expect(page.getByTestId('disk-value')).toBeVisible();
		await expect(page.getByTestId('uptime-value')).toBeVisible();
		await expect(page.getByTestId('container-value')).toBeVisible();
	});

	test('shows empty state when no projects', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@dashboard-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });

		await expect(page.getByTestId('empty-state')).toBeVisible();
		await expect(page.getByText('No projects yet')).toBeVisible();
		await expect(page.getByRole('link', { name: 'New Project' })).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-20-1.png', fullPage: true });
	});

	test('shows project rows after adding a project', async ({ page }) => {
		/* Insert a test project directly */
		const db = createClient({ url: 'file:local.db' });
		await db.execute(
			"INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, created_at, updated_at) VALUES ('test-proj-1', 'My SvelteKit App', 'my-sveltekit-app', 'https://github.com/test/repo', 'main', 'sveltekit', '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')"
		);
		await db.execute(
			"INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, created_at) VALUES ('dep-1', 'test-proj-1', 'abc1234567890', 'live', '2026-03-11T00:00:00Z')"
		);
		db.close();

		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@dashboard-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });

		await expect(page.getByTestId('project-table')).toBeVisible();
		await expect(page.getByTestId('project-row')).toBeVisible();
		await expect(page.getByText('My SvelteKit App')).toBeVisible();
		await expect(page.locator('.framework-badge').getByText('SvelteKit')).toBeVisible();
		await expect(page.getByText('abc1234')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-20-2.png', fullPage: true });
	});

	test('no console errors on dashboard', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@dashboard-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
