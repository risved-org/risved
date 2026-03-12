import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Onboarding: Success Screen', () => {
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

		const page = await browser.newPage();

		/* Create admin account */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@success-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		/* Set IP mode */
		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });

		/* Select a starter template and deploy */
		await page.locator('.template-card').first().click();
		await page.getByRole('button', { name: 'Deploy starter' }).click();
		await page.waitForURL('**/onboarding/success', { timeout: 60000 });

		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await page.goto('/onboarding/success');
		await page.waitForLoadState('networkidle');
	});

	test('shows success heading and confirmation message', async ({ page }) => {
		await expect(page.locator('h1')).toHaveText("You're all set");
		await expect(page.locator('.subtitle')).toContainText('deployed');

		await page.screenshot({ path: '.agent/screenshots/TASK-6-1.png', fullPage: true });
	});

	test('shows what-is-next cards', async ({ page }) => {
		await expect(page.locator('.next-card')).toHaveCount(3);
		await expect(page.locator('.next-card').nth(0)).toContainText('Deploy another project');
		await expect(page.locator('.next-card').nth(1)).toContainText('Add a custom domain');
		await expect(page.locator('.next-card').nth(2)).toContainText('Set up webhooks');
	});

	test('has open dashboard button that sets onboarding complete', async ({ page }) => {
		const dashboardBtn = page.getByRole('button', { name: 'Open dashboard' });
		await expect(dashboardBtn).toBeVisible();

		await dashboardBtn.click();
		/* Form action sets onboarding_complete then redirects — may land on /login if session context differs */
		await page.waitForURL(/\/(login)?$/, { timeout: 15000 });

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
		await page.goto('/onboarding/success');
		await page.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	});
});
