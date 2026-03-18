import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Onboarding: DNS Verification', () => {
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

		/* Create admin account */
		const page = await browser.newPage();
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@verify-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		/* Configure subdomain domain */
		await page.locator('input#baseDomain').fill('example.com');
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/verify', { timeout: 60000 });
		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await page.goto('/onboarding/verify');
		await page.waitForLoadState('networkidle');
	});

	test('shows DNS verification page with records', async ({ page }) => {
		await expect(page.locator('h1')).toHaveText('Verify DNS records');

		const steps = page.locator('.step-label');
		await expect(steps).toHaveCount(4);

		/* Server IP displayed */
		await expect(page.locator('.ip-value')).toBeVisible();

		/* DNS records displayed */
		const rows = page.locator('.dns-row');
		await expect(rows).toHaveCount(2);

		await page.screenshot({ path: '.agent/screenshots/TASK-4-1.png', fullPage: true });
	});

	test('has copy buttons for each record', async ({ page }) => {
		const copyButtons = page.locator('.copy-btn');
		/* 1 for server IP + 2 for DNS records */
		await expect(copyButtons).toHaveCount(3);
	});

	test('shows provider chips', async ({ page }) => {
		const chips = page.locator('.provider-chip');
		await expect(chips).toHaveCount(6);

		await expect(chips.first()).toHaveText('Cloudflare');

		/* Click a chip to show instructions */
		await chips.first().click();
		await expect(page.locator('.provider-hint')).toBeVisible();
		await expect(page.locator('.provider-hint')).toContainText('DNS');

		/* Click again to close */
		await chips.first().click();
		await expect(page.locator('.provider-hint')).not.toBeVisible();

		await page.screenshot({ path: '.agent/screenshots/TASK-4-2.png', fullPage: true });
	});

	test('Check DNS button triggers check and shows results', async ({ page }) => {
		await page.getByRole('button', { name: 'Check DNS' }).click();
		await page.waitForLoadState('networkidle');

		/* After checking, status badges should show "Not found" (since DNS isn't set up) */
		const notFound = page.locator('.status-badge.pending');
		await expect(notFound.first()).toBeVisible();

		/* Propagation hint shown */
		await expect(page.locator('.check-hint')).toBeVisible();
	});

	test('Skip button sets dns_verified and redirects', async ({ page }) => {
		/* Use standard form submit (not enhanced) so the redirect is a full navigation */
		const responsePromise = page.waitForResponse(
			(r) => r.url().includes('/onboarding/verify') && r.status() >= 300 && r.status() < 400
		);
		await page.getByRole('button', { name: 'Skip for now' }).click();
		const response = await responsePromise;
		expect(response.status()).toBe(303);

		const client = (await import('@libsql/client')).createClient({ url: 'file:test.db' });
		const result = await client.execute(
			"SELECT value FROM settings WHERE key = 'dns_verified'"
		);
		expect(result.rows[0]?.value).toBe('true');
		client.close();
	});

	test('no console errors on page load', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});
		await page.goto('/onboarding/verify');
		await page.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	});
});
