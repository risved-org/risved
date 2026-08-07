import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signInEmail: vi.fn(),
			signUpEmail: vi.fn(),
			signInSocial: vi.fn()
		}
	}
}));

import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { load, actions } from './+page.server';

function makeLoadEvent(user?: { id: string }) {
	return {
		locals: { user: user ?? null }
	} as unknown as Parameters<typeof load>[0];
}

function makeActionEvent(formEntries: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(formEntries)) {
		formData.append(key, value);
	}
	return {
		request: { formData: () => Promise.resolve(formData) }
	} as Parameters<typeof actions.signInEmail>[0];
}

describe('demo better-auth login load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to the demo home when already logged in', async () => {
		await expect(load(makeLoadEvent({ id: '1' }))).rejects.toMatchObject({
			status: 302,
			location: '/demo/better-auth'
		});
	});

	it('returns an empty object when not logged in', async () => {
		const result = await load(makeLoadEvent());
		expect(result).toEqual({});
	});
});

describe('demo better-auth signInEmail action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('signs in and redirects on success', async () => {
		vi.mocked(auth.api.signInEmail).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signInEmail>>
		);

		await expect(
			actions.signInEmail(makeActionEvent({ email: 'a@b.com', password: 'password1' }))
		).rejects.toMatchObject({ status: 302, location: '/demo/better-auth' });

		expect(auth.api.signInEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({ email: 'a@b.com', password: 'password1' })
			})
		);
	});

	it('returns a 400 failure on API errors', async () => {
		vi.mocked(auth.api.signInEmail).mockRejectedValue(
			new APIError('BAD_REQUEST', { message: 'Invalid credentials' })
		);

		const result = await actions.signInEmail(
			makeActionEvent({ email: 'a@b.com', password: 'wrong' })
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('returns a 500 failure on unexpected errors', async () => {
		vi.mocked(auth.api.signInEmail).mockRejectedValue(new Error('DB down'));

		const result = await actions.signInEmail(
			makeActionEvent({ email: 'a@b.com', password: 'x' })
		);
		expect(result).toMatchObject({ status: 500, data: { message: 'Unexpected error' } });
	});
});

describe('demo better-auth signUpEmail action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('signs up and redirects on success', async () => {
		vi.mocked(auth.api.signUpEmail).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signUpEmail>>
		);

		await expect(
			actions.signUpEmail(
				makeActionEvent({ email: 'a@b.com', password: 'password1', name: 'Alice' })
			)
		).rejects.toMatchObject({ status: 302, location: '/demo/better-auth' });
	});

	it('returns a 400 failure on API errors', async () => {
		vi.mocked(auth.api.signUpEmail).mockRejectedValue(
			new APIError('BAD_REQUEST', { message: 'Email already exists' })
		);

		const result = await actions.signUpEmail(
			makeActionEvent({ email: 'a@b.com', password: 'x', name: 'Alice' })
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('returns a 500 failure on unexpected errors', async () => {
		vi.mocked(auth.api.signUpEmail).mockRejectedValue(new Error('DB down'));

		const result = await actions.signUpEmail(
			makeActionEvent({ email: 'a@b.com', password: 'x', name: 'Alice' })
		);
		expect(result).toMatchObject({ status: 500 });
	});
});

describe('demo better-auth signInSocial action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to the provider URL on success', async () => {
		vi.mocked(auth.api.signInSocial).mockResolvedValue({
			url: 'https://github.com/login/oauth/authorize'
		} as Awaited<ReturnType<typeof auth.api.signInSocial>>);

		await expect(
			actions.signInSocial(makeActionEvent({ provider: 'github' }))
		).rejects.toMatchObject({ status: 302, location: 'https://github.com/login/oauth/authorize' });
	});

	it('returns a 400 failure when no redirect URL is returned', async () => {
		vi.mocked(auth.api.signInSocial).mockResolvedValue({} as Awaited<
			ReturnType<typeof auth.api.signInSocial>
		>);

		const result = await actions.signInSocial(makeActionEvent({ provider: 'github' }));
		expect(result).toMatchObject({ status: 400 });
	});
});
