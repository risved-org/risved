import { describe, it, expect, vi } from 'vitest';
import { authClient } from '$lib/auth-client';
import * as authSchema from '$lib/server/db/auth.schema';

/* Mock modules needed by auth-client */
vi.mock('better-auth/svelte', () => ({
	createAuthClient: vi.fn((opts) => ({
		_plugins: opts?.plugins ?? [],
		signIn: { passkey: vi.fn() },
		passkey: {
			addPasskey: vi.fn(),
			listUserPasskeys: vi.fn(),
			deletePasskey: vi.fn()
		}
	}))
}));

vi.mock('@better-auth/passkey/client', () => ({
	passkeyClient: vi.fn(() => ({ id: 'passkey-client' }))
}));

describe('Passkey Authentication', () => {
	it('auth client includes passkey plugin', () => {
		const client = authClient as unknown as { _plugins: { id: string }[] };
		expect(client._plugins).toHaveLength(1);
		expect(client._plugins[0].id).toBe('passkey-client');
	});

	it('auth client exposes passkey methods', () => {
		expect(authClient.passkey).toBeDefined();
		expect(authClient.passkey.addPasskey).toBeDefined();
		expect(authClient.passkey.listUserPasskeys).toBeDefined();
		expect(authClient.passkey.deletePasskey).toBeDefined();
	});

	it('auth client exposes signIn.passkey method', () => {
		expect(authClient.signIn.passkey).toBeDefined();
	});

	it('auth schema includes passkey table', () => {
		expect(authSchema.passkey).toBeDefined();
	});

	it('passkey table has required columns', () => {
		const pk = authSchema.passkey;
		expect(pk).toBeDefined();
		/* Verify key columns exist by checking the column references */
		const cols = Object.keys(pk);
		expect(cols).toContain('id');
		expect(cols).toContain('publicKey');
		expect(cols).toContain('userId');
		expect(cols).toContain('credentialID');
		expect(cols).toContain('counter');
		expect(cols).toContain('deviceType');
		expect(cols).toContain('backedUp');
		expect(cols).toContain('name');
	});
});
