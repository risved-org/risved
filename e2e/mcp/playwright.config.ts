import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database =
	process.env.MCP_TEST_DATABASE ??
	`file:${join(mkdtempSync(join(tmpdir(), 'risved-mcp-')), 'test.db')}`
process.env.MCP_TEST_DATABASE = database

export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.ts',
	workers: 1,
	use: { baseURL: 'http://localhost:5188', headless: true },
	webServer: {
		command: 'bun run db:migrate && bun build/index.js',
		cwd: process.cwd(),
		url: 'http://localhost:5188/login',
		reuseExistingServer: false,
		env: {
			DATABASE_URL: database,
			ORIGIN: 'http://localhost:5188',
			BETTER_AUTH_URL: 'http://localhost:5188',
			BETTER_AUTH_SECRET: 'isolated-mcp-e2e-test-secret-32-characters',
			PORT: '5188',
			HOST: '127.0.0.1'
		}
	}
})
