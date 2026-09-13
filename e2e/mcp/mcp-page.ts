import { expect, type Page } from '@playwright/test'

export class McpPage {
	constructor(readonly page: Page) {}

	/** Sign in with the isolated fixture administrator. */
	async signIn() {
		await this.page.goto('/login')
		await this.page.getByLabel('Email', { exact: true }).fill('mcp-e2e@example.test')
		await this.page.getByLabel('Password', { exact: true }).fill('mcp-e2e-password-123')
		await this.page.getByRole('button', { name: 'Sign in', exact: true }).click()
		await expect(this.page).toHaveURL(/\/projects$/)
	}

	/** Mint a bearer key through the settings form. */
	async createKey() {
		await this.page.goto('/settings')
		const section = this.page.getByTestId('mcp-keys-section')
		await section.getByLabel('Key label').fill('MCP E2E')
		await section.getByRole('button', { name: 'Create key', exact: true }).click()
		const value = this.page.getByTestId('mcp-key-value')
		await expect(value).toBeVisible()
		return (await value.innerText()).trim()
	}
}
