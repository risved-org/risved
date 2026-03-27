import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { passkey } from '@better-auth/passkey';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

export const auth = betterAuth({
	baseURL: env.ORIGIN || undefined,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	trustedOrigins: env.ORIGIN ? [env.ORIGIN] : ['http://*', 'https://*'],
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		autoSignIn: true
	},
	plugins: [passkey(), sveltekitCookies(getRequestEvent)]
});
