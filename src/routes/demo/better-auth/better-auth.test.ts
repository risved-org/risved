import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signOut: vi.fn()
		}
	}
}));

import { auth } from '$lib/server/auth';
import { load, actions } from './+page.server';

function makeLoadEvent(user?: { id: string }) {
	return {
		locals: { user: user ?? null }
	} as unknown as Parameters<typeof load>[0];
}

function makeActionEvent() {
	return {
		request: { headers: new Headers() }
	} as Parameters<typeof actions.signOut>[0];
}

describe('demo better-auth load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to login when there is no user', async () => {
		await expect(load(makeLoadEvent())).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth/login'
		});
	});

	it('returns the user when logged in', async () => {
		const result = await load(makeLoadEvent({ id: '1' }));
		expect(result).toEqual({ user: { id: '1' } });
	});
});

describe('demo better-auth signOut action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.signOut).mockResolvedValue(undefined as never);
	});

	it('signs the user out and redirects to login', async () => {
		await expect(actions.signOut(makeActionEvent())).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth/login'
		});
		expect(auth.api.signOut).toHaveBeenCalled();
	});
});
