import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test.describe('Webhook Delivery Log', () => {
	const PROJECT_ID = 'webhook-del-proj-1';
	const SLUG = 'delivery-app';
	const DELIVERY_ID = 'del-test-001';

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
		`);
		client.close();

		const page = await browser.newPage();

		/* Create admin — retry goto to handle cold start 500s */
		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@delivery-test.com');
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
			`INSERT OR IGNORE INTO projects (id, name, slug, repo_url, branch, framework_id, webhook_secret, port, created_at, updated_at) VALUES ('${PROJECT_ID}', 'Delivery App', '${SLUG}', 'https://github.com/test/delivery', 'main', 'sveltekit', 'whsec_delsecret123', 3001, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO webhook_deliveries (id, project_id, event, headers, payload, signature_valid, action_taken, created_at) VALUES ('${DELIVERY_ID}', '${PROJECT_ID}', 'push', '{"content-type":"application/json","x-github-event":"push"}', '{"ref":"refs/heads/main","repository":{"full_name":"test/delivery"}}', 1, 'triggered deployment', '2026-03-11T12:00:00Z')`
		);
		await db.execute(
			`INSERT OR IGNORE INTO webhook_deliveries (id, project_id, event, headers, payload, signature_valid, action_taken, created_at) VALUES ('del-test-002', '${PROJECT_ID}', 'unknown', '{"content-type":"application/json"}', '{"action":"opened"}', 0, 'rejected: invalid signature', '2026-03-11T11:00:00Z')`
		);
		db.close();

		await page.close();
	});

	async function loginAndGo(page: import('@playwright/test').Page, path: string) {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@delivery-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('**/', { timeout: 15000 });
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}

	test('shows delivery list with rows', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/webhooks/deliveries`);

		await expect(page.getByTestId('deliveries-list')).toBeVisible();
		const rows = page.getByTestId('delivery-row');
		await expect(rows).toHaveCount(2);

		await expect(rows.first()).toContainText('push');
		await expect(rows.first().getByTestId('delivery-status')).toContainText('deployed');

		await page.screenshot({
			path: '.agent/screenshots/TASK-17-1.png',
			fullPage: true
		});
	});

	test('shows delivery detail with metadata, headers, and payload', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/webhooks/deliveries/${DELIVERY_ID}`);

		await expect(page.getByTestId('metadata-section')).toBeVisible();
		await expect(page.getByTestId('meta-grid')).toContainText(DELIVERY_ID);
		await expect(page.getByTestId('meta-grid')).toContainText('push');
		await expect(page.getByTestId('sig-status')).toContainText('Valid');

		await expect(page.getByTestId('headers-section')).toBeVisible();
		await expect(page.getByTestId('headers-block')).toContainText('content-type');
		await expect(page.getByTestId('headers-block')).toContainText('x-github-event');

		await expect(page.getByTestId('payload-section')).toBeVisible();
		await expect(page.getByTestId('payload-block')).toContainText('refs/heads/main');

		await page.screenshot({
			path: '.agent/screenshots/TASK-17-2.png',
			fullPage: true
		});
	});

	test('shows redeliver button', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/webhooks/deliveries/${DELIVERY_ID}`);

		await expect(page.getByTestId('redeliver-btn')).toBeVisible();
		await expect(page.getByTestId('redeliver-btn')).toContainText('Redeliver');
	});

	test('can navigate from webhook config to deliveries', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/webhooks`);

		await page.getByTestId('view-deliveries-btn').click();
		await page.waitForURL(`**/projects/${SLUG}/webhooks/deliveries`, { timeout: 10000 });
		await expect(page.getByTestId('deliveries-list')).toBeVisible();
	});

	test('can navigate from list to detail', async ({ page }) => {
		await loginAndGo(page, `/projects/${SLUG}/webhooks/deliveries`);

		await page.getByTestId('delivery-row').first().click();
		await page.waitForURL(`**/projects/${SLUG}/webhooks/deliveries/**`, { timeout: 10000 });
		await expect(page.getByTestId('metadata-section')).toBeVisible();
	});

	test('no console errors on delivery pages', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
				errors.push(msg.text());
		});

		await loginAndGo(page, `/projects/${SLUG}/webhooks/deliveries`);
		await page.getByTestId('delivery-row').first().click();
		await page.waitForLoadState('networkidle');

		expect(errors).toEqual([]);
	});
});
