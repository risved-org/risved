import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const fromMock = vi.fn();
	const selectMock = vi.fn(() => ({ from: fromMock }));
	return { db: { select: selectMock, __fromMock: fromMock } };
});

vi.mock('drizzle-orm', () => ({
	count: vi.fn(() => 'count_fn'),
	eq: vi.fn(() => 'eq_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table'
}));

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signInEmail: vi.fn()
		}
	}
}));

import { db } from '$lib/server/db';
import { auth } from '$lib/server/auth';
import { actions, load } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeLoadEvent(user?: { id: string; email: string }) {
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
		request: {
			formData: () => Promise.resolve(formData),
			headers: new Headers()
		},
		url: new URL('http://localhost/login')
	} as Parameters<typeof actions.default>[0];
}

describe('login load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const whereMock = vi.fn().mockResolvedValue([{ count: 1 }]);
		dbAny.__fromMock.mockReturnValueOnce([{ count: 5 }]).mockReturnValueOnce({ where: whereMock });
	});

	it('redirects to / if already logged in', async () => {
		await expect(load(makeLoadEvent({ id: '1', email: 'a@b.com' }))).rejects.toMatchObject({
			status: 302,
			location: '/'
		});
	});

	it('returns project counts when not logged in', async () => {
		const result = await load(makeLoadEvent());
		expect(result).toHaveProperty('projectCount');
		expect(result).toHaveProperty('runningCount');
	});
});

describe('login action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.signInEmail).mockResolvedValue(
			{} as Awaited<ReturnType<typeof auth.api.signInEmail>>
		);
	});

	it('signs in and redirects on success', async () => {
		await expect(
			actions.default(makeActionEvent({ email: 'a@b.com', password: 'validpassword1' }))
		).rejects.toMatchObject({ status: 302, location: '/' });

		expect(auth.api.signInEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { email: 'a@b.com', password: 'validpassword1' }
			})
		);
	});

	it('handles BetterAuth API errors', async () => {
		const { APIError } = await import('better-auth/api');
		vi.mocked(auth.api.signInEmail).mockRejectedValue(
			new APIError('BAD_REQUEST', { message: 'Invalid credentials' })
		);

		const result = await actions.default(
			makeActionEvent({ email: 'a@b.com', password: 'wrongpassword1' })
		);
		expect(result).toMatchObject({ status: 400 });
		expect(result?.data?.error).toBeTruthy();
		expect(result?.data?.email).toBe('a@b.com');
	});

	it('handles unexpected errors', async () => {
		vi.mocked(auth.api.signInEmail).mockRejectedValue(new Error('DB down'));

		const result = await actions.default(
			makeActionEvent({ email: 'a@b.com', password: 'somepassword1' })
		);
		expect(result).toMatchObject({
			status: 500,
			data: { error: 'An unexpected error occurred' }
		});
	});
});

describe('login page source', () => {
	it('includes RISVED wordmark', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('RISVED');
	});

	it('has email and password fields', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('type="email"');
		expect(mod.default).toContain('type="password"');
	});

	it('shows forgot password CLI command', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('risved reset-password');
	});

	it('has status footer with health dot', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('health-dot');
		expect(mod.default).toContain('status-footer');
	});

	it('uses JetBrains Mono for status footer', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});

	it('uses enhance for form submission', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});
});
