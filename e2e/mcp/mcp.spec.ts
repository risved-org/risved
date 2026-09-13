import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { McpPage } from './mcp-page'

const headers = { Accept: 'application/json, text/event-stream' }
let callback = ''
const callbackServer = createServer((_request, response) => response.end('Connection complete'))

/** Send an authenticated stateless MCP request. */
function rpc(request: APIRequestContext, key: string, method: string, params = {}) {
	return request.post('/mcp', {
		headers: { ...headers, Authorization: `Bearer ${key}` },
		data: { jsonrpc: '2.0', id: 1, method, params }
	})
}

test.beforeAll(async ({ request }) => {
	await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve))
	const address = callbackServer.address() as { port: number }
	callback = `http://127.0.0.1:${address.port}/callback`
	const response = await request.post('/api/auth/sign-up/email', {
		data: { name: 'MCP E2E', email: 'mcp-e2e@example.test', password: 'mcp-e2e-password-123' }
	})
	expect(response.ok()).toBeTruthy()
	const db = createClient({ url: process.env.MCP_TEST_DATABASE! })
	await db.execute(
		"INSERT OR REPLACE INTO settings(key,value) VALUES ('onboarding_complete','true')"
	)
	db.close()
})

test.afterAll(async () => {
	await new Promise<void>((resolve) => callbackServer.close(() => resolve()))
})

test('creates a key, completes a handshake, hides the key after reload and revokes access', async ({
	page,
	request
}) => {
	const ui = new McpPage(page)
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await ui.signIn()
	const key = await ui.createKey()
	const init = await rpc(request, key, 'initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'release-test', version: '1' }
	})
	expect(init.status()).toBe(200)
	expect((await init.json()).result.serverInfo).toMatchObject({ name: 'risved', version: '0.23.0' })
	const tools = await rpc(request, key, 'tools/list')
	expect((await tools.json()).result.tools).toHaveLength(7)
	const projects = await rpc(request, key, 'tools/call', { name: 'list_projects', arguments: {} })
	expect((await projects.json()).result.structuredContent).toEqual({ projects: [] })
	await page.reload()
	await expect(page.getByTestId('mcp-key-value')).toHaveCount(0)
	const section = page.getByTestId('mcp-keys-section')
	await section.screenshot({ path: '/private/tmp/risved-mcp-settings-verified.png' })
	await section.getByRole('button', { name: 'Revoke', exact: true }).click()
	await expect(section.getByText('No access keys.', { exact: true })).toBeVisible()
	expect((await rpc(request, key, 'tools/list')).status()).toBe(401)
	expect(errors).toEqual([])
})

test('discovers OAuth, requires approval, exchanges an S256 code and rejects code reuse', async ({
	page,
	request
}) => {
	const anonymous = await request.post('/mcp', {
		headers,
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
	})
	expect(anonymous.status()).toBe(401)
	expect(anonymous.headers()['www-authenticate']).toContain('oauth-protected-resource')
	const discovery = await request.get('/.well-known/oauth-authorization-server')
	expect(discovery.status()).toBe(200)
	const metadata = await discovery.json()
	const registration = await request.post(metadata.registration_endpoint, {
		data: {
			client_name: 'Release verification',
			redirect_uris: [callback],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code'],
			response_types: ['code']
		}
	})
	expect(registration.ok()).toBeTruthy()
	const client = await registration.json()
	const verifier = randomBytes(32).toString('base64url')
	const params = new URLSearchParams({
		client_id: client.client_id,
		redirect_uri: callback,
		response_type: 'code',
		scope: 'openid',
		state: 'release-test-state',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256'
	})
	await page.goto(metadata.authorization_endpoint + '?' + params)
	await page.getByLabel('Email', { exact: true }).fill('mcp-e2e@example.test')
	await page.getByLabel('Password', { exact: true }).fill('mcp-e2e-password-123')
	await page.getByRole('button', { name: 'Sign in', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Connect Release verification?' })).toBeVisible()
	await page.screenshot({ path: '/private/tmp/risved-mcp-consent.png' })
	await page.getByRole('button', { name: 'Allow access', exact: true }).click()
	await expect(page).toHaveURL(/\/callback\?code=/)
	const authorized = new URL(page.url())
	expect(authorized.searchParams.get('state')).toBe('release-test-state')
	const form = {
		grant_type: 'authorization_code',
		client_id: client.client_id,
		redirect_uri: callback,
		code: authorized.searchParams.get('code')!,
		code_verifier: verifier
	}
	// The form-token compatibility proposal is intentionally not applied yet.
	expect((await request.post(metadata.token_endpoint, { form })).status()).toBe(403)
	expect(
		(
			await request.post('/settings?/createMcpKey', {
				headers: { Origin: 'https://attacker.test' },
				form: { label: 'forbidden' }
			})
		).status()
	).toBe(403)
	const token = await request.post(metadata.token_endpoint, { data: form })
	expect(token.ok(), await token.text()).toBeTruthy()
	const access = await token.json()
	expect((await rpc(request, access.access_token, 'tools/list')).status()).toBe(200)
	expect((await request.post(metadata.token_endpoint, { data: form })).ok()).toBeFalsy()
	params.set('state', 'denied-state')
	await page.goto(metadata.authorization_endpoint + '?' + params)
	await page.getByRole('button', { name: 'Deny', exact: true }).click()
	await expect(page).toHaveURL(/error=access_denied/)
	params.delete('code_challenge')
	params.delete('code_challenge_method')
	await page.goto(metadata.authorization_endpoint + '?' + params)
	await expect(page).toHaveURL(/error=invalid_request/)
})
