import { test, expect } from '@playwright/test';

test.describe('Onboarding: Create Admin Account', () => {
	test('shows create admin form on first run', async ({ page }) => {
		await page.goto('/onboarding');

		await expect(page.locator('h1')).toHaveText('Create admin account');
		await expect(page.locator('input#email')).toBeVisible();
		await expect(page.locator('input#password')).toBeVisible();
		await expect(page.locator('input#confirmPassword')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

		// Step indicator should show 4 steps
		const steps = page.locator('.step-label');
		await expect(steps).toHaveCount(4);
		await expect(steps.nth(0)).toHaveText('Account');
		await expect(steps.nth(1)).toHaveText('Domain');
		await expect(steps.nth(2)).toHaveText('Verify');
		await expect(steps.nth(3)).toHaveText('Deploy');

		// Take screenshot
		await page.screenshot({ path: '.agent/screenshots/TASK-2-1.png', fullPage: true });
	});

	test('shows validation hints for short password', async ({ page }) => {
		await page.goto('/onboarding');

		const passwordInput = page.locator('input#password');
		await passwordInput.fill('short');
		await expect(page.locator('.hint.error')).toBeVisible();
		await expect(page.locator('.hint.error')).toContainText('5/12 characters');
	});

	test('shows mismatch error for different passwords', async ({ page }) => {
		await page.goto('/onboarding');

		await page.locator('input#password').fill('validpassword1');
		await page.locator('input#confirmPassword').fill('differentpass1');
		await expect(page.locator('.hint.error')).toContainText('Passwords do not match');
	});

	test('disables submit when password is too short', async ({ page }) => {
		await page.goto('/onboarding');

		await page.locator('input#email').fill('admin@example.com');
		await page.locator('input#password').fill('short');
		await page.locator('input#confirmPassword').fill('short');

		const button = page.getByRole('button', { name: 'Create account' });
		await expect(button).toBeDisabled();
	});

	test('no console errors on page load', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	});
});
