import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('New Project Screen', () => {
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
			DELETE FROM env_vars;
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@new-project-test.com');
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

	async function loginAndGoToNew(page: import('@playwright/test').Page) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@new-project-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto('/new');
		await page.waitForLoadState('networkidle');
	}

	test('displays all form sections', async ({ page }) => {
		await loginAndGoToNew(page);

		await expect(page.getByTestId('git-section')).toBeVisible();
		await expect(page.getByTestId('detection-section')).toBeVisible();
		await expect(page.getByTestId('config-section')).toBeVisible();
		await expect(page.getByTestId('env-section')).toBeVisible();
		await expect(page.getByTestId('deploy-btn')).toBeVisible();
		await expect(page.getByTestId('repo-url-input')).toBeVisible();
		await expect(page.getByTestId('branch-input')).toBeVisible();
		await expect(page.getByTestId('root-dir-input')).toBeVisible();
		await expect(page.getByTestId('framework-select')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-21-1.png', fullPage: true });
	});

	test('back link navigates to dashboard', async ({ page }) => {
		await loginAndGoToNew(page);

		const backLink = page.getByTestId('back-link');
		await expect(backLink).toBeVisible();
		await expect(backLink).toHaveAttribute('href', '/');
	});

	test('framework select shows all options', async ({ page }) => {
		await loginAndGoToNew(page);

		const select = page.getByTestId('framework-select');
		const options = await select.locator('option').allTextContents();
		expect(options).toContain('Auto-detect');
		expect(options).toContain('SvelteKit');
		expect(options).toContain('Next.js');
		expect(options).toContain('Astro');
	});

	test('can add and remove env variable rows', async ({ page }) => {
		await loginAndGoToNew(page);

		/* Initially empty */
		await expect(page.getByText('No environment variables configured.')).toBeVisible();

		/* Add a row */
		await page.getByTestId('env-add-btn').click();
		await expect(page.getByTestId('env-row')).toBeVisible();
		await expect(page.getByText('No environment variables configured.')).not.toBeVisible();

		/* Fill the row */
		await page.getByTestId('env-key-input').fill('API_KEY');
		await page.getByTestId('env-value-input').fill('sk-test123');

		/* Remove the row */
		await page.getByTestId('env-remove-btn').click();
		await expect(page.getByTestId('env-row')).not.toBeVisible();
		await expect(page.getByText('No environment variables configured.')).toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-21-2.png', fullPage: true });
	});

	test('no console errors on new project page', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGoToNew(page);

		expect(errors).toEqual([]);
	});
});
