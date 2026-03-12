import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/auth-utils', () => ({
	isFirstRun: vi.fn()
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn(),
	setSetting: vi.fn()
}));

import { isFirstRun } from '$lib/server/auth-utils';
import { getSetting, setSetting } from '$lib/server/settings';
import { load, actions } from './+page.server';

type LoadParams = Parameters<typeof load>[0];
type ActionParams = Parameters<typeof actions.dashboard>[0];

function makeActionEvent(): ActionParams {
	return {
		request: {
			formData: () => Promise.resolve(new FormData()),
			headers: new Headers()
		},
		url: new URL('http://localhost/onboarding/success')
	} as ActionParams;
}

describe('success load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /onboarding if first run', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(true);
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding'
		});
	});

	it('redirects to /onboarding/deploy if no deploy config', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue(null);
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/deploy'
		});
	});

	it('returns starter deploy data with app URL', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'first_deploy')
				return JSON.stringify({
					type: 'starter',
					templateId: 'fresh',
					repoUrl: 'https://github.com/denoland/fresh',
					framework: 'fresh'
				});
			if (key === 'domain_config')
				return JSON.stringify({
					mode: 'subdomain',
					prefix: 'risved',
					baseDomain: 'example.com'
				});
			return null;
		});

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.deployType).toBe('starter');
		expect(result.templateId).toBe('fresh');
		expect(result.appUrl).toBe('https://fresh.risved.example.com');
	});

	it('returns repo deploy data', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'first_deploy')
				return JSON.stringify({
					type: 'repo',
					repoUrl: 'https://github.com/user/repo.git',
					branch: 'main'
				});
			if (key === 'domain_config')
				return JSON.stringify({ mode: 'dedicated', baseDomain: 'myapp.com' });
			return null;
		});

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.deployType).toBe('repo');
		expect(result.repoUrl).toBe('https://github.com/user/repo.git');
		expect(result.appUrl).toBe('https://myapp.com');
	});

	it('returns IP-based URL for ip mode', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'first_deploy') return JSON.stringify({ type: 'starter', templateId: 'hono' });
			if (key === 'domain_config')
				return JSON.stringify({ mode: 'ip', baseDomain: '192.168.1.100' });
			return null;
		});

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.appUrl).toBe('http://192.168.1.100');
	});

	it('returns empty appUrl when no domain config', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'first_deploy') return JSON.stringify({ type: 'starter', templateId: 'fresh' });
			return null;
		});

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.appUrl).toBe('');
	});
});

describe('success dashboard action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sets onboarding complete and redirects to dashboard', async () => {
		await expect(actions.dashboard(makeActionEvent())).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(setSetting).toHaveBeenCalledWith('onboarding_complete', 'true');
	});
});

describe('success page source', () => {
	it('has success heading', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain("You're all set");
	});

	it('has open dashboard button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('Open dashboard');
		expect(mod.default).toContain('?/dashboard');
	});

	it('has what-is-next cards', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain("What's next");
		expect(mod.default).toContain('Deploy another project');
		expect(mod.default).toContain('Add a custom domain');
		expect(mod.default).toContain('Set up webhooks');
	});

	it('shows app URL with mono font', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
		expect(mod.default).toContain('appUrl');
	});

	it('uses enhance for client-side form submission', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});
});
