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
import { STARTER_TEMPLATES } from './templates';

type LoadParams = Parameters<typeof load>[0];
type ActionParams = Parameters<typeof actions.starter>[0];

function makeActionEvent(formEntries: Record<string, string> = {}): ActionParams {
	const formData = new FormData();
	for (const [k, v] of Object.entries(formEntries)) {
		formData.set(k, v);
	}
	return {
		request: {
			formData: () => Promise.resolve(formData),
			headers: new Headers()
		},
		url: new URL('http://localhost/onboarding/deploy')
	} as ActionParams;
}

describe('deploy load', () => {
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

	it('redirects to /onboarding/domain if no domain config and dns not verified', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'dns_verified') return null;
			if (key === 'domain_config') return null;
			return null;
		});
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/domain'
		});
	});

	it('redirects to /onboarding/verify if dns not verified but domain config exists', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'dns_verified') return null;
			if (key === 'domain_config') return JSON.stringify({ mode: 'subdomain' });
			return null;
		});
		await expect(load({} as LoadParams)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/verify'
		});
	});

	it('returns templates when dns is verified', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'dns_verified') return 'true';
			return null;
		});

		const result = (await load({} as LoadParams)) as Record<string, unknown>;
		expect(result.templates).toEqual(STARTER_TEMPLATES);
		expect(result.templates).toHaveLength(4);
	});
});

describe('deploy starter action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fails if no template selected', async () => {
		const result = await actions.starter(makeActionEvent({}));
		expect(result).toMatchObject({ status: 400 });
	});

	it('fails for invalid template id', async () => {
		const result = await actions.starter(makeActionEvent({ templateId: 'nonexistent' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('saves first_deploy and redirects to success for valid template', async () => {
		await expect(actions.starter(makeActionEvent({ templateId: 'fresh' }))).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/success'
		});

		expect(setSetting).toHaveBeenCalledWith(
			'first_deploy',
			expect.stringContaining('"templateId":"fresh"')
		);
	});
});

describe('deploy repo action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fails if no repo URL', async () => {
		const result = await actions.repo(makeActionEvent({}));
		expect(result).toMatchObject({ status: 400 });
	});

	it('fails for invalid git URL', async () => {
		const result = await actions.repo(makeActionEvent({ repoUrl: 'not-a-url' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('saves first_deploy and redirects to success for valid HTTPS git URL', async () => {
		await expect(
			actions.repo(
				makeActionEvent({
					repoUrl: 'https://github.com/user/repo.git',
					branch: 'develop'
				})
			)
		).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/success'
		});

		expect(setSetting).toHaveBeenCalledWith(
			'first_deploy',
			expect.stringContaining('"type":"repo"')
		);
		expect(setSetting).toHaveBeenCalledWith(
			'first_deploy',
			expect.stringContaining('"branch":"develop"')
		);
	});

	it('defaults branch to main', async () => {
		await expect(
			actions.repo(makeActionEvent({ repoUrl: 'https://github.com/user/repo.git' }))
		).rejects.toMatchObject({ status: 303 });

		expect(setSetting).toHaveBeenCalledWith(
			'first_deploy',
			expect.stringContaining('"branch":"main"')
		);
	});

	it('accepts GitHub URL without .git extension', async () => {
		await expect(
			actions.repo(makeActionEvent({ repoUrl: 'https://github.com/user/repo' }))
		).rejects.toMatchObject({ status: 303 });
	});
});

describe('deploy skip action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sets onboarding complete and redirects to dashboard', async () => {
		await expect(actions.skip(makeActionEvent())).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(setSetting).toHaveBeenCalledWith('onboarding_complete', 'true');
	});
});

describe('deploy page source', () => {
	it('includes step indicator at step 4', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('StepIndicator');
		expect(mod.default).toContain('current={4}');
	});

	it('has starter template grid', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('template-grid');
		expect(mod.default).toContain('template-card');
	});

	it('has own repo fields', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('repoUrl');
		expect(mod.default).toContain('branch');
	});

	it('has skip button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('Skip');
		expect(mod.default).toContain('?/skip');
	});
});

describe('STARTER_TEMPLATES', () => {
	it('has 4 templates', () => {
		expect(STARTER_TEMPLATES).toHaveLength(4);
	});

	it('each template has required fields', () => {
		for (const t of STARTER_TEMPLATES) {
			expect(t.id).toBeTruthy();
			expect(t.name).toBeTruthy();
			expect(t.framework).toBeTruthy();
			expect(t.description).toBeTruthy();
			expect(t.repoUrl).toBeTruthy();
			expect(t.estimatedTime).toBeTruthy();
		}
	});

	it('includes expected frameworks', () => {
		const ids = STARTER_TEMPLATES.map((t) => t.id);
		expect(ids).toContain('fresh');
		expect(ids).toContain('hono');
		expect(ids).toContain('sveltekit');
		expect(ids).toContain('astro');
	});
});
