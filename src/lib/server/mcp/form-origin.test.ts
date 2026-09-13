import { describe, expect, it } from 'vitest'
import { rejectsCrossSiteForm } from './form-origin'

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

describe('proposed MCP token form-origin exception', () => {
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
