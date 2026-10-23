import { betterAuth } from 'better-auth/minimal'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { sveltekitCookies } from 'better-auth/svelte-kit'
import { passkey } from '@better-auth/passkey'
import { createAuthMiddleware } from 'better-auth/api'
import { mcp } from 'better-auth/plugins'
import { env } from '$env/dynamic/private'
import { getRequestEvent } from '$app/server'
import { db } from '$lib/server/db'

export const auth = betterAuth({
	baseURL: env.ORIGIN || undefined,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	trustedOrigins: env.ORIGIN ? [env.ORIGIN] : ['http://*', 'https://*'],
	advanced: {
		trustedProxyHeaders: true,
		useSecureCookies: env.ORIGIN ? env.ORIGIN.startsWith('https://') : false
	},
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		autoSignIn: true
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path === '/mcp/authorize' && ctx.query) ctx.query.prompt = 'consent'
		})
	},
	plugins: [
		passkey(),
		/*
		 * OAuth 2.1 authorization server for MCP clients. Agents that support
		 * remote MCP (Claude Code, Codex) discover it at
		 * /.well-known/oauth-authorization-server and register dynamically.
		 */
		mcp({
			loginPage: '/login',
			resource: env.ORIGIN ? new URL('/mcp', env.ORIGIN).href : undefined,
			oidcConfig: {
				loginPage: '/login',
				consentPage: '/oauth/consent',
				requirePKCE: true,
				allowPlainCodeChallengeMethod: false
			}
		}),
		sveltekitCookies(getRequestEvent)
	]
})
