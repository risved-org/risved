import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../scripts/risved.mjs');

async function cli(...args: string[]) {
	try {
		const { stdout, stderr } = await exec('node', [CLI, ...args], {
			cwd: resolve(__dirname, '..'),
			env: { ...process.env, DATABASE_URL: 'file:test.db' }
		});
		return { stdout, stderr, code: 0 };
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; code?: number };
		return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.code ?? 1 };
	}
}

test.describe('CLI Tool', () => {
	test.beforeAll(async ({ browser }) => {
		const client = createClient({ url: 'file:test.db' });
		await client.executeMultiple(`
			DELETE FROM session;
			DELETE FROM account;
			DELETE FROM verification;
			DELETE FROM passkey;
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

		await page.goto('/onboarding');
		await page.waitForLoadState('networkidle');
		await page.locator('input#email').fill('admin@cli-test.com');
		await page.locator('input#password').fill('testpassword12');
		await page.locator('input#confirmPassword').fill('testpassword12');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/onboarding/domain', { timeout: 60000 });

		await page.getByRole('button', { name: /IP-only mode/ }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForURL('**/onboarding/deploy', { timeout: 60000 });
		await page.getByRole('button', { name: /skip/i }).click();
		await page.waitForURL('**/', { timeout: 60000 });

		const db = createClient({ url: 'file:test.db' });
		await db.execute(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')"
		);

		/* Create a test project for CLI commands */
		await db.execute({
			sql: `INSERT OR REPLACE INTO projects (id, name, slug, repo_url, branch, port, created_at, updated_at)
				  VALUES ('cli-e2e-project', 'CLI E2E App', 'cli-e2e-app', 'https://github.com/test/app', 'main', 3060, datetime('now'), datetime('now'))`
		});

		/* Create a deployment for log tests */
		await db.execute({
			sql: `INSERT OR REPLACE INTO deployments (id, project_id, status, created_at)
				  VALUES ('cli-e2e-dep', 'cli-e2e-project', 'success', datetime('now'))`
		});

		await db.execute({
			sql: `INSERT INTO build_logs (deployment_id, timestamp, phase, level, message)
				  VALUES ('cli-e2e-dep', datetime('now'), 'build', 'info', 'E2E test build log')`
		});

		db.close();
		await page.close();
	});

	test('help command lists all subcommands', async () => {
		const result = await cli('--help');
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('status');
		expect(result.stdout).toContain('deploy');
		expect(result.stdout).toContain('logs');
		expect(result.stdout).toContain('reset-password');
		expect(result.stdout).toContain('env');
	});

	test('status command lists projects', async () => {
		const result = await cli('status');
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Risved Status');
		expect(result.stdout).toContain('CLI E2E App');
	});

	test('logs command streams build output', async () => {
		const result = await cli('logs', 'cli-e2e-app');
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('CLI E2E App');
		expect(result.stdout).toContain('E2E test build log');
	});

	test('env command manages variables', async () => {
		/* Set a variable */
		let result = await cli('env', 'cli-e2e-app', 'set', 'TEST_KEY=test_value');
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Set TEST_KEY');

		/* List should show the variable */
		result = await cli('env', 'cli-e2e-app');
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('TEST_KEY');
		expect(result.stdout).toContain('test_value');

		/* Remove the variable */
		result = await cli('env', 'cli-e2e-app', 'rm', 'TEST_KEY');
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Removed TEST_KEY');
	});

	test('unknown command shows error', async () => {
		const result = await cli('foobar');
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain('Unknown command');
	});
});
