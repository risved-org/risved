import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signOut: vi.fn()
		}
	}
}));

import { auth } from '$lib/server/auth';
import { actions, load } from './+page.server';

function makeLoadEvent(user?: { id: string; email: string }) {
	return {
		locals: { user: user ?? null }
	} as unknown as Parameters<typeof load>[0];
}

function makeSignOutEvent() {
	return {
		request: {
			headers: new Headers()
		}
	} as Parameters<typeof actions.signOut>[0];
}

describe('demo/better-auth load', () => {
	it('redirects to login when not authenticated', async () => {
		await expect(load(makeLoadEvent())).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth/login'
		});
	});

	it('returns user when authenticated', async () => {
		const result = await load(makeLoadEvent({ id: '1', email: 'a@b.com' }));
		expect(result).toEqual({ user: { id: '1', email: 'a@b.com' } });
	});
});

describe('demo/better-auth signOut action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.signOut).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signOut>>
		);
	});

	it('signs out and redirects to login', async () => {
		await expect(actions.signOut(makeSignOutEvent())).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth/login'
		});
		expect(auth.api.signOut).toHaveBeenCalledWith(
			expect.objectContaining({ headers: expect.any(Headers) })
		);
	});
});
