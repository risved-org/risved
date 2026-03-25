import { test, expect } from '@playwright/test'
import { createClient } from '@libsql/client'

test.describe('Self-Update Feature', () => {
	test.beforeAll(async ({ browser }, testInfo) => {
		testInfo.setTimeout(90000)

		/* Determine which DB the server is using */
		const dbUrl = process.env.DATABASE_URL || 'file:test.db'
		const client = createClient({ url: dbUrl })
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
		`)
		client.close()

		const page = await browser.newPage()
		await page.goto('/onboarding')
		await page.waitForLoadState('networkidle')

		await page.locator('input#email').waitFor({ timeout: 30000 })
		await page.locator('input#email').fill('admin@update-test.com')
		await page.locator('input#password').fill('testpassword12')
		await page.locator('input#confirmPassword').fill('testpassword12')
		await page.getByRole('button', { name: 'Create account' }).click()
		await page.waitForURL('**/onboarding/git', { timeout: 60000 })

		await page.getByTestId('skip-btn').click()
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 })

		await page.getByRole('button', { name: /IP-only mode/ }).click()
		await page.getByRole('button', { name: 'Continue' }).click()
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 })
		await page.getByRole('button', { name: /skip/i }).click()
		await page.waitForURL('**/', { timeout: 60000 })

		const db = createClient({ url: dbUrl })
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		)
		db.close()

		await page.close()
	})

	async function loginAndGo(page: import('@playwright/test').Page, path: string) {
		await page.goto('/login')
		await page.waitForLoadState('networkidle')
		await page.locator('input#email').fill('admin@update-test.com')
		await page.locator('input#password').fill('testpassword12')
		await page.getByRole('button', { name: 'Sign in', exact: true }).click()
		await page.waitForURL('**/', { timeout: 15000 })
		await page.goto(path)
		await page.waitForLoadState('networkidle')
	}

	test('shows update section on settings page', async ({ page }) => {
		await loginAndGo(page, '/settings')

		await expect(page.getByTestId('update-section')).toBeVisible()
		await expect(page.getByTestId('update-version')).toBeVisible()
		await expect(page.getByTestId('check-updates-btn')).toBeVisible()
	})

	test('shows current version', async ({ page }) => {
		await loginAndGo(page, '/settings')

		const versionSection = page.getByTestId('update-version')
		await expect(versionSection).toContainText('Risved')
	})

	test('check for updates button works', async ({ page }) => {
		await loginAndGo(page, '/settings')

		const btn = page.getByTestId('check-updates-btn')
		await expect(btn).toBeEnabled()
		await btn.click()

		/* Button should show loading state */
		await expect(btn).toContainText(/Checking/)
	})

	test('GET /api/system/update returns update info', async ({ page }) => {
		await loginAndGo(page, '/settings')

		const res = await page.request.get('/api/system/update')
		expect(res.status()).toBe(200)

		const body = await res.json()
		expect(body).toHaveProperty('currentVersion')
		expect(body).toHaveProperty('updateAvailable')
		expect(typeof body.currentVersion).toBe('string')
		expect(typeof body.updateAvailable).toBe('boolean')
	})

	test('POST /api/system/update requires update to be available', async ({ page }) => {
		await loginAndGo(page, '/settings')

		const res = await page.request.post('/api/system/update')
		/* Should fail since no real update is available */
		expect(res.status()).toBe(400)
		const body = await res.json()
		expect(body.error).toBeTruthy()
	})

	test('no console errors on settings page with update section', async ({ page }) => {
		const errors: string[] = []
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text())
		})

		await loginAndGo(page, '/settings')
		await page.waitForLoadState('networkidle')

		expect(errors).toEqual([])
	})
})
