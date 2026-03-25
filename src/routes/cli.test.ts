import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../scripts/risved.mjs');
const DB_URL = 'file:risved.db';

async function run(...args: string[]) {
	try {
		const { stdout, stderr } = await exec('node', [CLI, ...args], {
			cwd: resolve(import.meta.dirname, '../..'),
			env: { ...process.env, DATABASE_URL: DB_URL }
		});
		return { stdout, stderr, code: 0 };
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; code?: number };
		return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.code ?? 1 };
	}
}

describe('Risved CLI', () => {
	let db: ReturnType<typeof createClient>;

	beforeAll(async () => {
		db = createClient({ url: DB_URL });

		/* Ensure test data exists */
		await db.executeMultiple(`
			INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_complete', 'true');
			INSERT OR REPLACE INTO settings (key, value) VALUES ('api_token', 'rsv_test_token_1234');
		`);
	});

	afterAll(() => {
		db?.close();
	});

	it('shows help with --help flag', async () => {
		const result = await run('--help');
		expect(result.stdout).toContain('risved');
		expect(result.stdout).toContain('Commands');
		expect(result.stdout).toContain('status');
		expect(result.stdout).toContain('deploy');
		expect(result.stdout).toContain('logs');
		expect(result.stdout).toContain('reset-password');
		expect(result.stdout).toContain('env');
		expect(result.code).toBe(0);
	});

	it('shows help with no arguments', async () => {
		const result = await run();
		expect(result.stdout).toContain('Commands');
		expect(result.code).toBe(0);
	});

	it('exits with error for unknown command', async () => {
		const result = await run('unknown-cmd');
		expect(result.stderr).toContain('Unknown command');
		expect(result.code).not.toBe(0);
	});

	it('status command shows project table', async () => {
		const result = await run('status');
		expect(result.stdout).toContain('Risved Status');
		expect(result.code).toBe(0);
	});

	it('deploy requires a project argument', async () => {
		const result = await run('deploy');
		expect(result.stderr).toContain('required');
		expect(result.code).not.toBe(0);
	});

	it('logs requires a project argument', async () => {
		const result = await run('logs');
		expect(result.stderr).toContain('required');
		expect(result.code).not.toBe(0);
	});

	it('env requires a project argument', async () => {
		const result = await run('env');
		expect(result.stderr).toContain('required');
		expect(result.code).not.toBe(0);
	});

	it('deploy fails with non-existent project', async () => {
		const result = await run('deploy', 'nonexistent-project-xyz');
		expect(result.stderr).toContain('not found');
		expect(result.code).not.toBe(0);
	});

	it('logs fails with non-existent project', async () => {
		const result = await run('logs', 'nonexistent-project-xyz');
		expect(result.stderr).toContain('not found');
		expect(result.code).not.toBe(0);
	});

	it('env fails with non-existent project', async () => {
		const result = await run('env', 'nonexistent-project-xyz');
		expect(result.stderr).toContain('not found');
		expect(result.code).not.toBe(0);
	});
});

describe('Risved CLI with test project', () => {
	let db: ReturnType<typeof createClient>;
	const PROJECT_ID = 'cli-test-project-id';

	beforeAll(async () => {
		db = createClient({ url: DB_URL });

		/* Create a test project */
		await db.execute({
			sql: `INSERT OR REPLACE INTO projects (id, name, slug, repo_url, branch, port, created_at, updated_at)
				  VALUES (?, 'CLI Test App', 'cli-test-app', 'https://github.com/test/repo', 'main', 3050, datetime('now'), datetime('now'))`,
			args: [PROJECT_ID]
		});

		/* Create a test deployment */
		await db.execute({
			sql: `INSERT OR REPLACE INTO deployments (id, project_id, status, created_at)
				  VALUES ('cli-test-dep-1', ?, 'success', datetime('now'))`,
			args: [PROJECT_ID]
		});

		/* Create a test build log */
		await db.execute({
			sql: `INSERT INTO build_logs (deployment_id, timestamp, phase, level, message)
				  VALUES ('cli-test-dep-1', datetime('now'), 'build', 'info', 'Test build log message')`,
		});
	});

	afterAll(async () => {
		if (db) {
			await db.executeMultiple(`
				DELETE FROM build_logs WHERE deployment_id = 'cli-test-dep-1';
				DELETE FROM env_vars WHERE project_id = '${PROJECT_ID}';
				DELETE FROM deployments WHERE project_id = '${PROJECT_ID}';
				DELETE FROM projects WHERE id = '${PROJECT_ID}';
			`);
			db.close();
		}
	});

	it('status shows the test project', async () => {
		const result = await run('status');
		expect(result.stdout).toContain('CLI Test App');
		expect(result.stdout).toContain('success');
		expect(result.code).toBe(0);
	});

	it('logs shows build logs for project', async () => {
		const result = await run('logs', 'cli-test-app');
		expect(result.stdout).toContain('CLI Test App');
		expect(result.stdout).toContain('Test build log message');
		expect(result.stdout).toContain('build');
		expect(result.code).toBe(0);
	});

	it('env list shows no variables initially', async () => {
		const result = await run('env', 'cli-test-app');
		expect(result.stdout).toContain('CLI Test App');
		expect(result.stdout).toContain('No environment variables');
		expect(result.code).toBe(0);
	});

	it('env set creates a variable', async () => {
		const result = await run('env', 'cli-test-app', 'set', 'MY_VAR=hello');
		expect(result.stdout).toContain('Set MY_VAR');
		expect(result.code).toBe(0);
	});

	it('env list shows the created variable', async () => {
		const result = await run('env', 'cli-test-app');
		expect(result.stdout).toContain('MY_VAR');
		expect(result.stdout).toContain('hello');
		expect(result.code).toBe(0);
	});

	it('env rm removes the variable', async () => {
		const result = await run('env', 'cli-test-app', 'rm', 'MY_VAR');
		expect(result.stdout).toContain('Removed MY_VAR');
		expect(result.code).toBe(0);
	});

	it('env rm warns for non-existent variable', async () => {
		const result = await run('env', 'cli-test-app', 'rm', 'DOES_NOT_EXIST');
		expect(result.stdout).toContain('not found');
		expect(result.code).toBe(0);
	});

	it('env set requires KEY=VALUE format', async () => {
		const result = await run('env', 'cli-test-app', 'set', 'INVALID');
		expect(result.stderr).toContain('KEY=VALUE');
		expect(result.code).not.toBe(0);
	});
});
