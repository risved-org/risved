#!/usr/bin/env node

/**
 * Risved CLI — manage your Risved instance from the terminal.
 *
 * Commands:
 *   risved deploy [project]        Trigger a deployment
 *   risved logs [project]          Stream build logs for latest deployment
 *   risved reset-password          Reset admin password
 *   risved status                  Show server and project status
 *   risved env [project]           List environment variables
 *   risved env [project] set K=V   Set an environment variable
 *   risved env [project] rm KEY    Remove an environment variable
 */

import { createClient } from '@libsql/client';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/* ── Output helpers ───────────────────────────────────────────── */

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const info = (msg) => console.log(`${BLUE}▸${RESET} ${msg}`);
const ok = (msg) => console.log(`${GREEN}✓${RESET} ${msg}`);
const warn = (msg) => console.log(`${YELLOW}⚠${RESET} ${msg}`);
const err = (msg) => console.error(`${RED}✗${RESET} ${msg}`);

/* ── Database ─────────────────────────────────────────────────── */

function findDbPath() {
	/* Check common locations for the database file */
	const candidates = [
		resolve(process.cwd(), 'local.db'),
		resolve(process.cwd(), 'data/local.db'),
		'/opt/risved/data/local.db'
	];
	for (const p of candidates) {
		if (existsSync(p)) return `file:${p}`;
	}
	/* Fall back to DATABASE_URL env var */
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	return 'file:local.db';
}

function getDb() {
	return createClient({ url: findDbPath() });
}

/* ── Prompt helper ────────────────────────────────────────────── */

function prompt(question, hidden = false) {
	return new Promise((res) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		if (hidden && process.stdin.isTTY) {
			process.stdout.write(question);
			const stdin = process.stdin;
			stdin.setRawMode(true);
			stdin.resume();
			let input = '';
			const onData = (ch) => {
				const c = ch.toString();
				if (c === '\n' || c === '\r') {
					stdin.setRawMode(false);
					stdin.removeListener('data', onData);
					rl.close();
					process.stdout.write('\n');
					res(input);
				} else if (c === '\u0003') {
					process.exit(1);
				} else if (c === '\u007f' || c === '\b') {
					if (input.length > 0) input = input.slice(0, -1);
				} else {
					input += c;
				}
			};
			stdin.on('data', onData);
		} else {
			rl.question(question, (answer) => {
				rl.close();
				res(answer);
			});
		}
	});
}

/* ── Resolve project by slug or name ──────────────────────────── */

async function resolveProject(db, identifier) {
	if (!identifier) {
		err('Project name or slug is required');
		process.exit(1);
	}
	const rows = await db.execute({
		sql: 'SELECT * FROM projects WHERE slug = ? OR name = ? LIMIT 1',
		args: [identifier, identifier]
	});
	if (rows.rows.length === 0) {
		err(`Project not found: ${identifier}`);
		process.exit(1);
	}
	return rows.rows[0];
}

/* ── Commands ─────────────────────────────────────────────────── */

async function cmdStatus() {
	const db = getDb();
	try {
		const projects = await db.execute('SELECT id, name, slug, port, domain FROM projects');
		const deployments = await db.execute(
			`SELECT d.project_id, d.status, d.created_at
			 FROM deployments d
			 INNER JOIN (
				 SELECT project_id, MAX(created_at) as max_created
				 FROM deployments GROUP BY project_id
			 ) latest ON d.project_id = latest.project_id AND d.created_at = latest.max_created`
		);

		const deployMap = new Map();
		for (const d of deployments.rows) {
			deployMap.set(d.project_id, d);
		}

		console.log(`\n${BOLD}Risved Status${RESET}\n`);

		if (projects.rows.length === 0) {
			info('No projects configured');
		} else {
			const header = `  ${'PROJECT'.padEnd(25)} ${'STATUS'.padEnd(12)} ${'PORT'.padEnd(6)} DOMAIN`;
			console.log(`${DIM}${header}${RESET}`);
			console.log(`${DIM}  ${'─'.repeat(65)}${RESET}`);

			for (const p of projects.rows) {
				const dep = deployMap.get(p.id);
				const status = dep?.status ?? 'never deployed';
				const statusColor =
					status === 'success' ? GREEN : status === 'failed' ? RED : YELLOW;
				const port = p.port ? String(p.port) : '—';
				const domain = p.domain || '—';
				console.log(
					`  ${String(p.name).padEnd(25)} ${statusColor}${String(status).padEnd(12)}${RESET} ${String(port).padEnd(6)} ${domain}`
				);
			}
		}

		console.log(
			`\n${DIM}  ${projects.rows.length} project${projects.rows.length === 1 ? '' : 's'} total${RESET}\n`
		);
	} finally {
		db.close();
	}
}

async function cmdDeploy(projectSlug) {
	const db = getDb();
	try {
		const project = await resolveProject(db, projectSlug);

		/* Get the API token and origin for making HTTP requests */
		const tokenRow = await db.execute(
			"SELECT value FROM settings WHERE key = 'api_token'"
		);
		const originRow = await db.execute("SELECT value FROM settings WHERE key = 'hostname'");

		const apiToken = tokenRow.rows[0]?.value;
		if (!apiToken) {
			err('No API token configured. Generate one in Settings > API Token first.');
			process.exit(1);
		}

		const origin = process.env.ORIGIN || 'http://localhost:5173';
		const url = `${origin}/api/projects/${project.id}/deploy`;

		info(`Deploying ${BOLD}${project.name}${RESET}...`);

		const resp = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			}
		});

		const body = await resp.json();
		if (resp.ok && body.success) {
			ok(`Deployment started (ID: ${body.deploymentId})`);
		} else {
			err(`Deployment failed: ${body.error || resp.statusText}`);
			process.exit(1);
		}
	} finally {
		db.close();
	}
}

async function cmdLogs(projectSlug) {
	const db = getDb();
	try {
		const project = await resolveProject(db, projectSlug);

		/* Find the latest deployment for this project */
		const depRows = await db.execute({
			sql: 'SELECT id, status, created_at FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
			args: [project.id]
		});

		if (depRows.rows.length === 0) {
			info(`No deployments found for ${project.name}`);
			return;
		}

		const deployment = depRows.rows[0];
		console.log(
			`\n${BOLD}Build logs: ${project.name}${RESET} ${DIM}(${deployment.id})${RESET}\n`
		);

		const logs = await db.execute({
			sql: 'SELECT timestamp, phase, level, message FROM build_logs WHERE deployment_id = ? ORDER BY id ASC',
			args: [deployment.id]
		});

		for (const log of logs.rows) {
			const levelColor =
				log.level === 'error' ? RED : log.level === 'warn' ? YELLOW : DIM;
			const ts = String(log.timestamp).slice(11, 19);
			console.log(
				`${DIM}${ts}${RESET} ${BLUE}[${log.phase}]${RESET} ${levelColor}${log.message}${RESET}`
			);
		}

		console.log(
			`\n${DIM}  Status: ${deployment.status} | ${logs.rows.length} log entries${RESET}\n`
		);
	} finally {
		db.close();
	}
}

async function cmdResetPassword() {
	console.log(`\n${BOLD}Reset Admin Password${RESET}\n`);

	const db = getDb();
	try {
		/* Get the first (admin) user */
		const users = await db.execute('SELECT id, email FROM user LIMIT 1');
		if (users.rows.length === 0) {
			err('No users found. Complete onboarding first.');
			process.exit(1);
		}

		const adminUser = users.rows[0];
		info(`Admin account: ${adminUser.email}`);

		const password = await prompt('New password (min 12 chars): ', true);
		if (!password || password.length < 12) {
			err('Password must be at least 12 characters');
			process.exit(1);
		}

		const confirm = await prompt('Confirm password: ', true);
		if (password !== confirm) {
			err('Passwords do not match');
			process.exit(1);
		}

		/* Hash the password using BetterAuth's algorithm */
		const { hashPassword } = await import('better-auth/crypto');
		const hashed = await hashPassword(password);

		/* Update the account table */
		await db.execute({
			sql: "UPDATE account SET password = ? WHERE user_id = ? AND provider_id = 'credential'",
			args: [hashed, adminUser.id]
		});

		ok('Password reset successfully');
	} finally {
		db.close();
	}
}

async function cmdEnv(projectSlug, action, ...args) {
	const db = getDb();
	try {
		const project = await resolveProject(db, projectSlug);

		if (!action || action === 'list') {
			/* List environment variables */
			const vars = await db.execute({
				sql: 'SELECT key, value, is_secret FROM env_vars WHERE project_id = ? ORDER BY key',
				args: [project.id]
			});

			console.log(`\n${BOLD}Environment: ${project.name}${RESET}\n`);

			if (vars.rows.length === 0) {
				info('No environment variables set');
			} else {
				for (const v of vars.rows) {
					const display = v.is_secret ? '••••••••' : v.value;
					console.log(`  ${GREEN}${v.key}${RESET}=${display}`);
				}
			}
			console.log('');
			return;
		}

		if (action === 'set') {
			const pair = args[0];
			if (!pair || !pair.includes('=')) {
				err('Usage: risved env <project> set KEY=VALUE');
				process.exit(1);
			}
			const eqIdx = pair.indexOf('=');
			const key = pair.slice(0, eqIdx);
			const value = pair.slice(eqIdx + 1);

			if (!key) {
				err('Key cannot be empty');
				process.exit(1);
			}

			const now = new Date().toISOString();
			await db.execute({
				sql: `INSERT INTO env_vars (id, project_id, key, value, is_secret, created_at, updated_at)
					  VALUES (lower(hex(randomblob(16))), ?, ?, ?, 0, ?, ?)
					  ON CONFLICT (project_id, key) DO UPDATE SET value = ?, updated_at = ?`,
				args: [project.id, key, value, now, now, value, now]
			});

			ok(`Set ${key} for ${project.name}`);
			return;
		}

		if (action === 'rm' || action === 'remove' || action === 'delete') {
			const key = args[0];
			if (!key) {
				err('Usage: risved env <project> rm KEY');
				process.exit(1);
			}

			const result = await db.execute({
				sql: 'DELETE FROM env_vars WHERE project_id = ? AND key = ?',
				args: [project.id, key]
			});

			if (result.rowsAffected > 0) {
				ok(`Removed ${key} from ${project.name}`);
			} else {
				warn(`Variable ${key} not found`);
			}
			return;
		}

		err(`Unknown env action: ${action}. Use: list, set, rm`);
		process.exit(1);
	} finally {
		db.close();
	}
}

/* ── Usage ────────────────────────────────────────────────────── */

function printUsage() {
	console.log(`
${BOLD}risved${RESET} — Risved CLI

${BOLD}Usage:${RESET}
  risved <command> [options]

${BOLD}Commands:${RESET}
  ${GREEN}status${RESET}                      Show server and project status
  ${GREEN}deploy${RESET} <project>             Trigger a deployment
  ${GREEN}logs${RESET} <project>               Show build logs for latest deployment
  ${GREEN}reset-password${RESET}               Reset admin password from server terminal
  ${GREEN}env${RESET} <project>                List environment variables
  ${GREEN}env${RESET} <project> set KEY=VALUE  Set an environment variable
  ${GREEN}env${RESET} <project> rm KEY         Remove an environment variable

${DIM}Project can be specified by slug or name.${RESET}
`);
}

/* ── Main ─────────────────────────────────────────────────────── */

const [, , command, ...rest] = process.argv;

if (!command || command === '--help' || command === '-h') {
	printUsage();
	process.exit(0);
}

try {
	switch (command) {
		case 'status':
			await cmdStatus();
			break;
		case 'deploy':
			await cmdDeploy(rest[0]);
			break;
		case 'logs':
			await cmdLogs(rest[0]);
			break;
		case 'reset-password':
			await cmdResetPassword();
			break;
		case 'env':
			await cmdEnv(rest[0], rest[1], ...rest.slice(2));
			break;
		default:
			err(`Unknown command: ${command}`);
			printUsage();
			process.exit(1);
	}
} catch (e) {
	err(e.message || String(e));
	process.exit(1);
}
