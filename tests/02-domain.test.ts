import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Onboarding: Domain Setup', () => {
	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:test.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM user;
			DELETE FROM settings;
		`);
		client.close();

		const page = await browser.newPage();
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@domain-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });
		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await page.goto('/onboarding/domain');
		await page.waitForLoadState('networkidle');
	});

	test('shows domain configuration page with three radio options', async ({ page }) => {
		await expect(page.locator('h1')).toHaveText('Configure your domain');

		const cards = page.locator('.radio-card');
		await expect(cards).toHaveCount(3);
		await expect(cards.nth(0)).toHaveClass(/selected/);

		const steps = page.locator('.step-label');
		await expect(steps).toHaveCount(4);

		await page.screenshot({ path: '.agent/screenshots/TASK-3-1.png', fullPage: true });
	});

	test('shows live URL preview for subdomain mode', async ({ page }) => {
		await page.locator('input#baseDomain').fill('example.com');

		const preview = page.locator('.url-preview');
		await expect(preview).toBeVisible();
		await expect(preview.locator('.preview-url').first()).toContainText('risved.example.com');

		await page.screenshot({ path: '.agent/screenshots/TASK-3-2.png', fullPage: true });
	});

	test('prefix picker updates URL preview', async ({ page }) => {
		await page.locator('input#baseDomain').fill('example.com');
		await expect(page.locator('.preview-url').first()).toContainText('risved.example.com');

		/* Click prefix button and wait for the custom input to update */
		await page.getByRole('button', { name: 'deploy' }).click();
		await expect(page.locator('input#prefix')).toHaveValue('deploy');
		await expect(page.locator('.preview-url').first()).toContainText('deploy.example.com');
	});

	test('dedicated mode shows single domain input', async ({ page }) => {
		/* Click the dedicated domain radio card */
		await page.getByRole('button', { name: /Dedicated domain/ }).click();
		await expect(page.getByRole('button', { name: /Dedicated domain/ })).toHaveClass(/selected/);

		const domainInput = page.locator('input#baseDomain');
		await expect(domainInput).toBeVisible();

		await domainInput.fill('deploy.example.com');
		await expect(page.locator('.preview-url').first()).toContainText('deploy.example.com');
	});

	test('ip mode shows http preview', async ({ page }) => {
		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await expect(page.getByRole('button', { name: /IP-only mode/ })).toHaveClass(/selected/);
		await expect(page.locator('.preview-url').first()).toContainText('http://');
	});

	test('no console errors on page load', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});
		await page.goto('/onboarding/domain');
		await page.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	});
});
