import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Onboarding: First Deploy', () => {
	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:local.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM user;
			DELETE FROM settings;
		`);
		client.close();

		/* Create admin account */
		const page = await browser.newPage();
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@deploy-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		/* Set IP mode (auto-skips DNS verify) */
		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });
		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await page.goto('/onboarding/deploy');
		await page.waitForLoadState('networkidle');
	});

	test('shows deploy page with step indicator at step 4', async ({ page }) => {
		await expect(page.locator('h1')).toHaveText('Deploy your first app');

		const steps = page.locator('.step-label');
		await expect(steps).toHaveCount(4);

		await page.screenshot({ path: '.agent/screenshots/TASK-5-1.png', fullPage: true });
	});

	test('shows 4 starter template cards in 2x2 grid', async ({ page }) => {
		const cards = page.locator('.template-card');
		await expect(cards).toHaveCount(4);

		await expect(cards.nth(0)).toContainText('Fresh');
		await expect(cards.nth(1)).toContainText('Hono');
		await expect(cards.nth(2)).toContainText('SvelteKit');
		await expect(cards.nth(3)).toContainText('Astro');
	});

	test('selecting a template enables deploy button', async ({ page }) => {
		const deployBtn = page.getByRole('button', { name: 'Deploy starter' });
		await expect(deployBtn).toBeDisabled();

		await page.locator('.template-card').first().click();
		await expect(deployBtn).toBeEnabled();

		await page.screenshot({ path: '.agent/screenshots/TASK-5-2.png', fullPage: true });
	});

	test('switching to own repo tab shows git URL input', async ({ page }) => {
		await page.getByRole('button', { name: 'Own repository' }).click();

		await expect(page.locator('input#repoUrl')).toBeVisible();
		await expect(page.locator('input#branch')).toBeVisible();

		const deployBtn = page.getByRole('button', { name: 'Deploy from repo' });
		await expect(deployBtn).toBeDisabled();

		await page.locator('input#repoUrl').fill('https://github.com/user/repo.git');
		await expect(deployBtn).toBeEnabled();
	});

	test('skip button sets onboarding complete and redirects', async ({ page }) => {
		const responsePromise = page.waitForResponse(
			(r) => r.url().includes('/onboarding/deploy') && r.status() >= 300 && r.status() < 400
		);
		await page.getByRole('button', { name: /Skip/ }).click();
		const response = await responsePromise;
		expect(response.status()).toBe(303);

		const client = (await import('@libsql/client')).createClient({ url: 'file:local.db' });
		const result = await client.execute(
			"SELECT value FROM settings WHERE key = 'onboarding_complete'"
		);
		expect(result.rows[0]?.value).toBe('true');
		client.close();
	});

	test('no console errors on page load', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});
		await page.goto('/onboarding/deploy');
		await page.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	});
});
