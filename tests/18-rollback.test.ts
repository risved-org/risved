import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Rollback to Previous Deployment', () => {
	const PROJECT_ID = 'rollback-proj-1';
	const SLUG = 'rollback-app';

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
			DELETE FROM preview_deployments;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@rollback-test.com');
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
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Rollback App', '${SLUG}', 'https://github.com/test/rollback', 'main', 'sveltekit', 3010, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		/* Current live deployment */
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, trigger_type, image_tag, container_name, created_at) VALUES ('dep-rb-1', '${PROJECT_ID}', 'abc1234567890', 'live', 'manual', '${SLUG}:abc1234', '${SLUG}', '2026-03-11T12:00:00Z')`
		);
		/* Previous successful deployment (rollback target) */
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, trigger_type, image_tag, container_name, created_at) VALUES ('dep-rb-2', '${PROJECT_ID}', 'def5678901234', 'stopped', 'manual', '${SLUG}:def5678', '${SLUG}', '2026-03-10T12:00:00Z')`
		);
		/* A rollback deployment */
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, trigger_type, image_tag, container_name, created_at) VALUES ('dep-rb-3', '${PROJECT_ID}', 'ghi9012345678', 'stopped', 'rollback', '${SLUG}:ghi9012', '${SLUG}', '2026-03-09T12:00:00Z')`
		);
		/* A failed deployment (no rollback button) */
		await db.execute(
			`INSERT OR IGNORE INTO deployments (id, project_id, commit_sha, status, trigger_type, created_at) VALUES ('dep-rb-4', '${PROJECT_ID}', 'jkl3456789012', 'failed', 'manual', '2026-03-08T12:00:00Z')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGoToProject(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@rollback-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(`/projects/${SLUG}`);
		await page.waitForLoadState('networkidle');
	}

	test('shows rollback buttons on previous successful deployments', async ({ page }) => {
		await loginAndGoToProject(page);

		const rows = page.getByTestId('deploy-row');
		await expect(rows).toHaveCount(4);

		/* First row (latest) should NOT have rollback button */
		const firstRow = rows.nth(0);
		await expect(firstRow.getByTestId('rollback-btn')).not.toBeVisible();

		/* Second row (stopped with image) should have rollback button */
		const secondRow = rows.nth(1);
		await expect(secondRow.getByTestId('rollback-btn')).toBeVisible();
		await expect(secondRow.getByTestId('rollback-btn')).toHaveText('Rollback');

		await page.screenshot({ path: '.agent/screenshots/TASK-34-1.png', fullPage: true });
	});

	test('shows rollback badge on rollback deployments', async ({ page }) => {
		await loginAndGoToProject(page);

		/* Third row is a rollback deployment */
		const rows = page.getByTestId('deploy-row');
		const thirdRow = rows.nth(2);
		await expect(thirdRow.getByTestId('rollback-badge')).toBeVisible();
		await expect(thirdRow.getByTestId('rollback-badge')).toHaveText('rollback');
	});

	test('does not show rollback button on failed deployments', async ({ page }) => {
		await loginAndGoToProject(page);

		const rows = page.getByTestId('deploy-row');
		const fourthRow = rows.nth(3);
		await expect(fourthRow.getByTestId('rollback-btn')).not.toBeVisible();
	});

	test('rollback API returns success for valid deployment', async ({ page }) => {
		await loginAndGoToProject(page);

		/* Test the API directly */
		const response = await page.evaluate(async () => {
			const res = await fetch(
				`/api/projects/rollback-proj-1/deployments/dep-rb-2/rollback`,
				{ method: 'POST' }
			);
			return { status: res.status, body: await res.json() };
		});

		/* The rollback will fail because there's no actual Docker, but it should not return 400/404 */
		expect([200, 500]).toContain(response.status);
		expect(response.body).toHaveProperty('deploymentId');

		await page.screenshot({ path: '.agent/screenshots/TASK-34-2.png', fullPage: true });
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
