import { describe, expect, it, vi } from 'vitest'
vi.mock('$app/environment', () => ({ dev: false }))
import { handleFormOrigin, rejectsCrossSiteForm } from './form-origin'

/** Build a form request with an optional browser Origin. */
function request(path: string, origin?: string, method = 'POST') {
	const url = new URL(path, 'https://risved.test')
	return {
		url,
		request: new Request(url, {
			method,
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				...(origin ? { origin } : {})
			}
		})
	}
}

describe('MCP token form-origin exception', () => {
	it('allows a non-browser token exchange but still protects settings and sign-in', () => {
		for (const [path, rejected] of [
			['/api/auth/mcp/token', false],
			['/settings', true],
			['/login', true],
			['/api/auth/sign-in/email', true],
			['/api/auth/mcp/authorize', true]
		] as const) {
			const input = request(path)
			expect(rejectsCrossSiteForm(input.request, input.url)).toBe(rejected)
		}
	})
	it('allows same-origin forms and rejects foreign origins outside the exact token endpoint', () => {
		const same = request('/settings', 'https://risved.test')
		expect(rejectsCrossSiteForm(same.request, same.url)).toBe(false)
		for (const path of ['/settings', '/api/auth/mcp/token/extra']) {
			const foreign = request(path, 'https://attacker.test')
			expect(rejectsCrossSiteForm(foreign.request, foreign.url)).toBe(true)
		}
	})
	it('does not exempt other mutation methods on the token path', () => {
		const input = request('/api/auth/mcp/token', undefined, 'DELETE')
		expect(rejectsCrossSiteForm(input.request, input.url)).toBe(true)
	})
})

it('rejects cross-origin form content types for every mutating method', () => {
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		for (const contentType of [
			'application/x-www-form-urlencoded',
			'multipart/form-data; boundary=test',
			'text/plain',
			'TEXT/PLAIN'
		]) {
			const input = request('/settings', 'https://attacker.test', method)
			input.request.headers.set('content-type', contentType)
			expect(rejectsCrossSiteForm(input.request, input.url)).toBe(true)
		}
	}
})

it('blocks a production form request before another handler can resolve it', async () => {
	const input = request('/settings', 'https://attacker.test')
	const resolve = vi.fn(async () => new Response('should not run'))
	const response = await handleFormOrigin({ event: input, resolve } as unknown as Parameters<
		typeof handleFormOrigin
	>[0])
	expect(response.status).toBe(403)
	expect(resolve).not.toHaveBeenCalled()
	const token = request('/api/auth/mcp/token')
	await handleFormOrigin({ event: token, resolve } as unknown as Parameters<
		typeof handleFormOrigin
	>[0])
	expect(resolve).toHaveBeenCalledOnce()
})
