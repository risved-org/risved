import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Build Log Screen', () => {
	const PROJECT_ID = 'buildlog-proj-1';
	const DEPLOYMENT_ID = 'buildlog-dep-1';
	const SLUG = 'buildlog-app';

	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:local.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM user;
			DELETE FROM settings;
			DELETE FROM build_logs;
			DELETE FROM deployments;
			DELETE FROM projects;
			DELETE FROM domains;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@buildlog-test.com');
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

		/* Mark onboarding complete + seed test data */
		const db = createClient({ url: 'file:local.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);
		await db.execute(
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, created_at, updated_at) VALUES ('${PROJECT_ID}', 'BuildLog App', '${SLUG}', 'https://github.com/test/buildlog', 'main', 'sveltekit', '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, started_at, finished_at, created_at) VALUES ('${DEPLOYMENT_ID}', '${PROJECT_ID}', 'abc1234567890', 'live', '2026-03-11T00:00:00Z', '2026-03-11T00:01:30Z', '2026-03-11T00:00:00Z')`
		);
		/* Insert some build logs */
		await db.execute(
			`INSERT OR IGNORE INTO build_logs (deployment_id, timestamp, phase, level, message) VALUES ('${DEPLOYMENT_ID}', '2026-03-11T00:00:01Z', 'clone', 'info', '$ git clone https://github.com/test/buildlog')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO build_logs (deployment_id, timestamp, phase, level, message) VALUES ('${DEPLOYMENT_ID}', '2026-03-11T00:00:05Z', 'detect', 'info', 'Detected framework: SvelteKit')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO build_logs (deployment_id, timestamp, phase, level, message) VALUES ('${DEPLOYMENT_ID}', '2026-03-11T00:00:10Z', 'build', 'info', '$ docker build -t buildlog-app:latest .')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO build_logs (deployment_id, timestamp, phase, level, message) VALUES ('${DEPLOYMENT_ID}', '2026-03-11T00:01:00Z', 'health', 'info', 'Health check passed')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO build_logs (deployment_id, timestamp, phase, level, message) VALUES ('${DEPLOYMENT_ID}', '2026-03-11T00:01:30Z', 'live', 'info', 'Deployment is live')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGoToBuildLog(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@buildlog-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(`/projects/${SLUG}/deployments/${DEPLOYMENT_ID}`);
		await page.waitForLoadState('networkidle');
	}

	test('shows phase indicator with all phases', async ({ page }) => {
		await loginAndGoToBuildLog(page);

		await expect(page.getByTestId('phase-indicator')).toBeVisible();
		const steps = page.getByTestId('phase-step');
		await expect(steps).toHaveCount(6);

		await page.screenshot({ path: '.agent/screenshots/TASK-22-1.png', fullPage: true });
	});

	test('shows metadata bar with status and commit', async ({ page }) => {
		await loginAndGoToBuildLog(page);

		await expect(page.getByTestId('metadata-bar')).toBeVisible();
		await expect(page.getByTestId('status-badge')).toContainText('live');
		await expect(page.getByTestId('commit-sha')).toContainText('abc1234');
		await expect(page.getByTestId('elapsed-time')).toBeVisible();
	});

	test('shows terminal with build logs', async ({ page }) => {
		await loginAndGoToBuildLog(page);

		const terminal = page.getByTestId('terminal');
		await expect(terminal).toBeVisible();
		await expect(terminal).toContainText('git clone');
		await expect(terminal).toContainText('SvelteKit');
		await expect(terminal).toContainText('docker build');
		await expect(terminal).toContainText('Deployment is live');
	});

	test('shows success actions for live deployment', async ({ page }) => {
		await loginAndGoToBuildLog(page);

		await expect(page.getByTestId('success-actions')).toBeVisible();
		await expect(page.getByTestId('view-project-btn')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-22-2.png', fullPage: true });
	});

	test('no console errors on build log page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGoToBuildLog(page);

		expect(errors).toEqual([]);
	});
});
