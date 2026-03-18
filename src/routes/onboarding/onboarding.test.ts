import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn() }
}));

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signUpEmail: vi.fn()
		}
	}
}));

vi.mock('$lib/server/auth-utils', () => ({
	isFirstRun: vi.fn()
}));

import { auth } from '$lib/server/auth';
import { isFirstRun } from '$lib/server/auth-utils';
import { actions, load } from './+page.server';

function makeEvent(formEntries: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(formEntries)) {
		formData.append(key, value);
	}
	return {
		request: {
			formData: () => Promise.resolve(formData),
			headers: new Headers()
		},
		url: new URL('http://localhost/onboarding')
	} as Parameters<typeof actions.default>[0];
}

describe('onboarding load', () => {
	it('redirects to / if admin already exists', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		await expect(load({} as Parameters<typeof load>[0])).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
	});

	it('returns empty data on first run', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(true);
		const result = await load({} as Parameters<typeof load>[0]);
		expect(result).toEqual({});
	});
});

describe('onboarding action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isFirstRun).mockResolvedValue(true);
		vi.mocked(auth.api.signUpEmail).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signUpEmail>>
		);
	});

	it('requires email', async () => {
		const result = await actions.default(
			makeEvent({ email: '', password: 'validpassword1', confirmPassword: 'validpassword1' })
		);
		expect(result).toMatchObject({ status: 400, data: { error: 'Email is required.' } });
	});

	it('rejects passwords shorter than 8 characters', async () => {
		const result = await actions.default(
			makeEvent({ email: 'a@b.com', password: 'short', confirmPassword: 'short' })
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Password must be at least 8 characters.' }
		});
	});

	it('rejects mismatched passwords', async () => {
		const result = await actions.default(
			makeEvent({
				email: 'a@b.com',
				password: 'validpassword1',
				confirmPassword: 'differentpassword'
			})
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Passwords do not match.' }
		});
	});

	it('rejects if admin already exists', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		const result = await actions.default(
			makeEvent({
				email: 'a@b.com',
				password: 'validpassword1',
				confirmPassword: 'validpassword1'
			})
		);
		expect(result).toMatchObject({
			status: 403,
			data: { error: 'Admin account already exists.' }
		});
	});

	it('calls signUpEmail and redirects on success', async () => {
		await expect(
			actions.default(
				makeEvent({
					email: 'admin@example.com',
					password: 'validpassword1',
					confirmPassword: 'validpassword1'
				})
			)
		).rejects.toMatchObject({ status: 303, location: '/onboarding/git' });

		expect(auth.api.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { email: 'admin@example.com', password: 'validpassword1', name: 'Admin' }
			})
		);
	});

	it('handles BetterAuth API errors', async () => {
		const { APIError } = await import('better-auth/api');
		vi.mocked(auth.api.signUpEmail).mockRejectedValue(
			new APIError('BAD_REQUEST', { message: 'Email already in use' })
		);

		const result = await actions.default(
			makeEvent({
				email: 'a@b.com',
				password: 'validpassword1',
				confirmPassword: 'validpassword1'
			})
		);
		expect(result).toMatchObject({ status: 400 });
		expect(result?.data?.error).toBeTruthy();
	});

	it('handles unexpected errors', async () => {
		vi.mocked(auth.api.signUpEmail).mockRejectedValue(new Error('DB connection failed'));

		const result = await actions.default(
			makeEvent({
				email: 'a@b.com',
				password: 'validpassword1',
				confirmPassword: 'validpassword1'
			})
		);
		expect(result).toMatchObject({
			status: 500,
			data: { error: 'An unexpected error occurred.' }
		});
	});

	it('trims email whitespace', async () => {
		await expect(
			actions.default(
				makeEvent({
					email: '  admin@example.com  ',
					password: 'validpassword1',
					confirmPassword: 'validpassword1'
				})
			)
		).rejects.toMatchObject({ status: 303 });

		expect(auth.api.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({ email: 'admin@example.com' })
			})
		);
	});
});

describe('onboarding page source', () => {
	it('includes step indicator at step 0', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('StepIndicator');
		expect(mod.default).toContain('current={0}');
	});

	it('has password confirmation field', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('confirmPassword');
	});

	it('has 8-char minimum validation hint', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('minlength={8}');
	});
});

describe('step indicator source', () => {
	it('shows five steps: Account, Git, Domain, Verify, Deploy', async () => {
		const mod = await import('./StepIndicator.svelte?raw');
		const src = mod.default;
		expect(src).toContain('Account');
		expect(src).toContain('Git');
		expect(src).toContain('Domain');
		expect(src).toContain('Verify');
		expect(src).toContain('Deploy');
	});

	it('uses aria-current for active step', async () => {
		const mod = await import('./StepIndicator.svelte?raw');
		expect(mod.default).toContain('aria-current');
	});
});
