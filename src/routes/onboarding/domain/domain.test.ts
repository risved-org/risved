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
		url: new URL('http://localhost/onboarding/domain')
	} as Parameters<typeof actions.default>[0];
}

describe('domain load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /onboarding if first run (no admin)', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(true);
		vi.mocked(getSetting).mockResolvedValue(null);

		await expect(load({} as Parameters<typeof load>[0])).rejects.toMatchObject({
			status: 303,
			location: '/onboarding'
		});
	});

	it('returns empty data when no config saved', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue(null);

		const result = await load({} as Parameters<typeof load>[0]);
		expect(result).toEqual({});
	});

	it('returns existing domain config', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue(
			JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com', prefix: 'risved' })
		);

		const result = await load({} as Parameters<typeof load>[0]);
		expect(result).toEqual({
			domainConfig: { mode: 'subdomain', baseDomain: 'example.com', prefix: 'risved' }
		});
	});

	it('ignores corrupt JSON', async () => {
		vi.mocked(isFirstRun).mockResolvedValue(false);
		vi.mocked(getSetting).mockResolvedValue('{broken');

		const result = await load({} as Parameters<typeof load>[0]);
		expect(result).toEqual({});
	});
});

describe('domain action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(setSetting).mockResolvedValue(undefined);
	});

	it('rejects missing mode', async () => {
		const result = await actions.default(makeEvent({}));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Please select a domain configuration mode.' }
		});
	});

	it('rejects invalid mode', async () => {
		const result = await actions.default(makeEvent({ mode: 'invalid' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Please select a domain configuration mode.' }
		});
	});

	it('requires baseDomain for subdomain mode', async () => {
		const result = await actions.default(
			makeEvent({ mode: 'subdomain', baseDomain: '', prefix: 'risved' })
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Base domain is required.' }
		});
	});

	it('requires prefix for subdomain mode', async () => {
		const result = await actions.default(
			makeEvent({ mode: 'subdomain', baseDomain: 'example.com', prefix: '' })
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Subdomain prefix is required.' }
		});
	});

	it('requires baseDomain for dedicated mode', async () => {
		const result = await actions.default(makeEvent({ mode: 'dedicated', baseDomain: '' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Domain is required.' }
		});
	});

	it('saves config and redirects for subdomain mode', async () => {
		await expect(
			actions.default(makeEvent({ mode: 'subdomain', baseDomain: 'example.com', prefix: 'deploy' }))
		).rejects.toMatchObject({ status: 303, location: '/onboarding/verify' });

		expect(setSetting).toHaveBeenCalledWith(
			'domain_config',
			JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com', prefix: 'deploy' })
		);
	});

	it('saves config and redirects for dedicated mode', async () => {
		await expect(
			actions.default(makeEvent({ mode: 'dedicated', baseDomain: 'deploy.example.com' }))
		).rejects.toMatchObject({ status: 303, location: '/onboarding/verify' });

		expect(setSetting).toHaveBeenCalledWith(
			'domain_config',
			JSON.stringify({ mode: 'dedicated', baseDomain: 'deploy.example.com', prefix: '' })
		);
	});

	it('saves config and redirects for ip mode', async () => {
		await expect(actions.default(makeEvent({ mode: 'ip' }))).rejects.toMatchObject({
			status: 303,
			location: '/onboarding/verify'
		});

		expect(setSetting).toHaveBeenCalledWith(
			'domain_config',
			JSON.stringify({ mode: 'ip', baseDomain: '', prefix: '' })
		);
	});

	it('trims baseDomain and prefix whitespace', async () => {
		await expect(
			actions.default(
				makeEvent({
					mode: 'subdomain',
					baseDomain: '  example.com  ',
					prefix: '  risved  '
				})
			)
		).rejects.toMatchObject({ status: 303 });

		expect(setSetting).toHaveBeenCalledWith(
			'domain_config',
			JSON.stringify({ mode: 'subdomain', baseDomain: 'example.com', prefix: 'risved' })
		);
	});
});

describe('domain page source', () => {
	it('includes step indicator at step 1', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('StepIndicator');
		expect(mod.default).toContain('current={1}');
	});

	it('has three radio card options', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('subdomain');
		expect(mod.default).toContain('dedicated');
		expect(mod.default).toContain('ip');
	});

	it('has URL preview section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('url-preview');
	});

	it('has prefix picker with preset options', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('risved');
		expect(mod.default).toContain('deploy');
		expect(mod.default).toContain('apps');
	});
});
