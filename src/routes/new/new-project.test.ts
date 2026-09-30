import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn();
	const whereMock = vi.fn(() => ({ limit: limitMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	const returningMock = vi.fn();
	const valuesMock = vi.fn(() => ({ returning: returningMock }));
	const insertMock = vi.fn(() => ({ values: valuesMock }));
	return {
		db: {
			select: selectMock,
			insert: insertMock,
			__fromMock: fromMock,
			__whereMock: whereMock,
			__limitMock: limitMock,
			__valuesMock: valuesMock,
			__returningMock: returningMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	desc: vi.fn(() => 'desc_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	envVars: 'env_vars_table',
	gitConnections: 'git_connections_table'
}));

vi.mock('$lib/server/api-utils', () => ({
	slugify: vi.fn((name: string) =>
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	),
	generateWebhookSecret: vi.fn(() => 'whsec_test123')
}));

vi.mock('$lib/server/pipeline/port', () => ({
	allocatePort: vi.fn().mockResolvedValue(3001)
}));

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: vi.fn().mockResolvedValue({ success: true, deploymentId: 'dep-1' })
}));

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn(() => ({}))
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue('example.com')
}));

vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((value: string) => `encrypted:${value}`)
}));

vi.mock('$lib/server/auto-webhook', () => ({
	registerWebhook: vi.fn()
}));

import { db } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';
import { encrypt } from '$lib/server/crypto';
import { registerWebhook } from '$lib/server/auto-webhook';
import { load, actions } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeLoadEvent() {
	return {} as unknown as Parameters<typeof load>[0];
}

function makeActionEvent(formEntries: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(formEntries)) {
		formData.append(key, value);
	}
	return {
		request: {
			formData: () => Promise.resolve(formData)
		},
		url: new URL('http://localhost/new')
	} as Parameters<typeof actions.default>[0];
}

describe('new project load', () => {
	it('returns framework list and domain', async () => {
		const result = await load(makeLoadEvent()) as Record<string, unknown>;
		const frameworks = result.frameworks as { id: string; name: string; tier: string }[];
		expect(frameworks).toBeDefined();
		expect(frameworks.length).toBeGreaterThan(0);
		expect(frameworks[0]).toHaveProperty('id');
		expect(frameworks[0]).toHaveProperty('name');
		expect(frameworks[0]).toHaveProperty('tier');
		expect(result.domain).toBe('example.com');
	});

	it('includes sveltekit in framework options', async () => {
		const result = await load(makeLoadEvent()) as Record<string, unknown>;
		const frameworks = result.frameworks as { id: string; name: string }[];
		const sk = frameworks.find((f) => f.id === 'sveltekit');
		expect(sk).toBeDefined();
		expect(sk?.name).toBe('SvelteKit');
	});
});

describe('new project action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
		dbAny.__returningMock.mockResolvedValue([
			{
				id: 'proj-1',
				name: 'test-repo',
				slug: 'test-repo',
				repoUrl: 'https://github.com/user/test-repo.git',
				branch: 'main',
				port: 3001,
				frameworkId: null,
				tier: null,
				domain: null,
				webhookSecret: 'whsec_test123'
			}
		]);
	});

	it('fails if repo URL is missing', async () => {
		const result = await actions.default(makeActionEvent({ repoUrl: '' }));
		expect(result).toMatchObject({ status: 400 });
		expect(result?.data?.error).toContain('Repository URL is required');
	});

	it('fails if slug already exists', async () => {
		dbAny.__limitMock.mockResolvedValue([{ id: 'existing' }]);

		const result = await actions.default(
			makeActionEvent({
				repoUrl: 'https://github.com/user/test-repo.git',
				projectName: 'test-repo'
			})
		);
		expect(result).toMatchObject({ status: 409 });
		expect(result?.data?.error).toContain('already exists');
	});

	it('redirects to / on success', async () => {
		await expect(
			actions.default(makeActionEvent({ repoUrl: 'https://github.com/user/test-repo.git' }))
		).rejects.toMatchObject({ status: 303, location: '/' });
	});

	it('derives project name from URL', async () => {
		await expect(
			actions.default(makeActionEvent({ repoUrl: 'https://github.com/user/my-app.git' }))
		).rejects.toMatchObject({ status: 303 });
	});

	it('fails if a project name cannot be derived from the URL', async () => {
		const result = await actions.default(makeActionEvent({ repoUrl: '/' }));
		expect(result).toMatchObject({ status: 400 });
		expect(result?.data?.error).toContain('Could not determine project name');
	});

	it('fails if the derived slug has no alphanumeric characters', async () => {
		const result = await actions.default(
			makeActionEvent({ repoUrl: 'https://github.com/user/test-repo.git', projectName: '!!!' })
		);
		expect(result).toMatchObject({ status: 400 });
		expect(result?.data?.error).toContain('at least one alphanumeric character');
	});

	it('sets the project domain from a valid domain_config setting', async () => {
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'domain_config') return JSON.stringify({ baseDomain: 'example.com' });
			return 'example.com';
		});

		await expect(
			actions.default(makeActionEvent({ repoUrl: 'https://github.com/user/test-repo.git' }))
		).rejects.toMatchObject({ status: 303 });

		expect(dbAny.__valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ domain: 'test-repo.example.com' })
		);
	});

	it('ignores a corrupt domain_config setting', async () => {
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'domain_config') return 'not-json';
			return 'example.com';
		});

		await expect(
			actions.default(makeActionEvent({ repoUrl: 'https://github.com/user/test-repo.git' }))
		).rejects.toMatchObject({ status: 303 });

		expect(dbAny.__valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ domain: undefined })
		);
	});

	it('matches the tier for a recognized frameworkId', async () => {
		await expect(
			actions.default(
				makeActionEvent({
					repoUrl: 'https://github.com/user/test-repo.git',
					frameworkId: 'sveltekit'
				})
			)
		).rejects.toMatchObject({ status: 303 });

		expect(dbAny.__valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ frameworkId: 'sveltekit' })
		);
	});

	it('saves valid environment variables and skips invalid keys', async () => {
		await expect(
			actions.default(
				makeActionEvent({
					repoUrl: 'https://github.com/user/test-repo.git',
					envKeys: 'API_KEY\x1F1bad-key',
					envValues: 'secretvalue\x1Fnope',
					envSecrets: '1\x1F0'
				})
			)
		).rejects.toMatchObject({ status: 303 });

		expect(encrypt).toHaveBeenCalledWith('secretvalue');
		expect(encrypt).toHaveBeenCalledTimes(1);
		expect(dbAny.__valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ key: 'API_KEY', isSecret: true })
		);
	});

	it('registers a webhook and uses the configured hostname when a connection is set', async () => {
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'hostname') return 'risved.example.com';
			return 'example.com';
		});

		await expect(
			actions.default(
				makeActionEvent({
					repoUrl: 'https://github.com/user/test-repo.git',
					connectionId: 'conn-1'
				})
			)
		).rejects.toMatchObject({ status: 303 });

		expect(registerWebhook).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionId: 'conn-1',
				origin: 'https://risved.example.com'
			})
		);
	});

	it('falls back to the request origin when no hostname setting is configured', async () => {
		vi.mocked(getSetting).mockImplementation(async (key: string) => {
			if (key === 'hostname') return null;
			return 'example.com';
		});

		await expect(
			actions.default(
				makeActionEvent({
					repoUrl: 'https://github.com/user/test-repo.git',
					connectionId: 'conn-1'
				})
			)
		).rejects.toMatchObject({ status: 303 });

		expect(registerWebhook).toHaveBeenCalledWith(
			expect.objectContaining({ connectionId: 'conn-1', origin: 'http://localhost' })
		);
	});
});

describe('new project page source', () => {
	it('has repo URL input', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('repoUrl');
		expect(mod.default).toContain('Repository URL');
	});

	it('has branch and root directory fields', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('branch');
		expect(mod.default).toContain('Root directory');
	});

	it('has framework override dropdown', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('frameworkId');
		expect(mod.default).toContain('Auto-detect');
	});

	it('has environment variables editor', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('env-editor');
		expect(mod.default).toContain('Add variable');
	});

	it('has deploy button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('Deploy project');
	});

	it('uses enhance for form submission', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});

	it('has domain preview', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('domain-preview');
	});

	it('uses JetBrains Mono for env vars', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('font-mono');
	});
});
