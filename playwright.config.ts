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
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry',
		viewport: { width: 1366, height: 768 }
	},

	webServer: {
		command: 'npx svelte-kit sync && npm run dev -- --host 0.0.0.0',
		url: 'http://localhost:5173/login',
		reuseExistingServer: true,
		timeout: 120000,
		stdout: 'pipe',
		stderr: 'pipe'
	},

	// NB: only chromium will run in Docker (arm64).
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
