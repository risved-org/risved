import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: './tests',
	globalSetup: './tests/global-setup.ts',
	fullyParallel: false,
	globalTimeout: 30 * 60 * 1000,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: 'http://localhost:5174',
		trace: 'on-first-retry',
		viewport: { width: 1366, height: 768 }
	},

	webServer: {
		command: 'npx svelte-kit sync && npm run dev -- --host 0.0.0.0 --port 5174',
		url: 'http://localhost:5174/login',
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			DATABASE_URL: 'file:test.db'
		}
	},

	// NB: only chromium will run in Docker (arm64).
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
