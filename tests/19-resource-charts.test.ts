import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Resource Usage Charts', () => {
	const PROJECT_ID = 'metrics-proj-1';
	const SLUG = 'metrics-app';

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
			DELETE FROM resource_metrics;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@metrics-test.com');
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
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Metrics App', '${SLUG}', 'https://github.com/test/metrics', 'main', 'sveltekit', 3001, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, created_at) VALUES ('dep-metrics-1', '${PROJECT_ID}', 'abc1234567890', 'live', '2026-03-11T00:00:00Z')`
		);

		/* Seed some resource metrics for the last 24h */
		const now = new Date();
		for (let h = 0; h < 12; h++) {
			const bucket = new Date(now);
			bucket.setHours(bucket.getHours() - h);
			bucket.setMinutes(0, 0, 0);
			const cpu = Math.round((5 + Math.random() * 20) * 100);
			const mem = Math.round(100 + Math.random() * 300);
			await db.execute(
				`INSERT INTO resource_metrics (project_id, cpu_percent, memory_mb, memory_limit_mb, bucket, sample_count, created_at) VALUES ('${PROJECT_ID}', ${cpu}, ${mem}, 2048, '${bucket.toISOString()}', 5, '${new Date().toISOString()}')`
			);
		}

		db.close();
		await page.close();
	});

	async function loginAndGoToDashboard(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@metrics-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });
	}

	test('dashboard shows resource overview section', async ({ page }) => {
		await loginAndGoToDashboard(page);

		await expect(page.getByTestId('resource-overview')).toBeVisible();
		await expect(page.getByText('Resource Usage (24h)')).toBeVisible();

		/* Should have at least one line chart */
		await expect(page.getByTestId('line-chart').first()).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-37-1.png', fullPage: true });
	});

	test('project detail shows resource usage charts', async ({ page }) => {
		await loginAndGoToDashboard(page);
		await page.goto(`/projects/${SLUG}`);
		await page.waitForLoadState('networkidle');

		await expect(page.getByTestId('resource-section')).toBeVisible();
		await expect(page.getByText('Resource Usage (24h)')).toBeVisible();

		/* Should render chart SVGs with data */
		const charts = page.getByTestId('line-chart');
		await expect(charts.first()).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-37-2.png', fullPage: true });
	});

	test('no console errors on pages with charts', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGoToDashboard(page);
		await page.goto(`/projects/${SLUG}`);
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
