import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	db: { select: vi.fn() },
	getRepo: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: mocks.db }));
vi.mock('$lib/server/db/schema', () => ({
	gitConnections: { id: 'id', provider: 'provider', accessToken: 'access_token' }
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((c: unknown, v: unknown) => ({ eq: [c, v] })) }));
vi.mock('$lib/server/crypto', () => ({ safeDecrypt: (v: string) => v }));

/* A real class, not vi.fn().mockImplementation — clearAllMocks would wipe the
 * implementation off the latter and leave a non-constructor behind. */
vi.mock('$lib/server/github', () => ({
	GitHubClient: class {
		getRepo = mocks.getRepo;
	}
}));

const getRepo = mocks.getRepo;

import {
	createRemoteDetectionContext,
	gitInstallUrl,
	parseOwnerRepo,
	resolveGitHubRepo
} from './git-repo';

function connections(rows: Array<{ id: string; accessToken: string }>) {
	mocks.db.select.mockReturnValue({
		from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) })
	});
}

beforeEach(() => vi.clearAllMocks());

describe('parseOwnerRepo', () => {
	it.each([
		['risved-org/risved', { owner: 'risved-org', repo: 'risved' }],
		['github.com/risved-org/risved', { owner: 'risved-org', repo: 'risved' }],
		['https://github.com/risved-org/risved', { owner: 'risved-org', repo: 'risved' }],
		['https://github.com/risved-org/risved.git', { owner: 'risved-org', repo: 'risved' }],
		['git@github.com:risved-org/risved.git', { owner: 'risved-org', repo: 'risved' }],
		['  risved-org/risved/  ', { owner: 'risved-org', repo: 'risved' }]
	])('parses %s', (input, expected) => {
		expect(parseOwnerRepo(input)).toEqual(expected);
	});

	it.each([
		'',
		'risved',
		'a/b/c',
		'https://gitlab.com/owner/repo',
		'https://github.com/owner',
		'owner/re po'
	])('rejects %s', (input) => {
		expect(parseOwnerRepo(input)).toBeNull();
	});
});

describe('resolveGitHubRepo', () => {
	it('returns the first connection that can see the repo', async () => {
		connections([
			{ id: 'c-1', accessToken: 'tok-1' },
			{ id: 'c-2', accessToken: 'tok-2' }
		]);
		getRepo.mockResolvedValueOnce(null).mockResolvedValueOnce({ default_branch: 'trunk' });

		const resolved = await resolveGitHubRepo({ owner: 'o', repo: 'r' });

		expect(resolved?.connectionId).toBe('c-2');
		expect(resolved?.repo.default_branch).toBe('trunk');
	});

	it('returns null when no connection can see the repo', async () => {
		connections([{ id: 'c-1', accessToken: 'tok-1' }]);
		getRepo.mockResolvedValue(null);

		await expect(resolveGitHubRepo({ owner: 'o', repo: 'r' })).resolves.toBeNull();
	});

	it('skips a connection whose provider call throws', async () => {
		connections([
			{ id: 'c-1', accessToken: 'tok-1' },
			{ id: 'c-2', accessToken: 'tok-2' }
		]);
		getRepo.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce({ id: 7 });

		const resolved = await resolveGitHubRepo({ owner: 'o', repo: 'r' });

		expect(resolved?.connectionId).toBe('c-2');
	});

	it('returns null when no GitHub account is connected', async () => {
		connections([]);

		await expect(resolveGitHubRepo({ owner: 'o', repo: 'r' })).resolves.toBeNull();
	});
});

describe('gitInstallUrl', () => {
	it('is absolute against the request origin', () => {
		expect(gitInstallUrl('https://risved.example.com')).toBe(
			'https://risved.example.com/settings/git'
		);
	});
});

describe('createRemoteDetectionContext', () => {
	const target = { owner: 'o', repo: 'r' };

	function clientReturning(files: Record<string, string>) {
		const getFileContents = vi.fn(async (_o: string, _r: string, path: string) => {
			void _o;
			void _r;
			return files[path] ?? null;
		});
		return { getFileContents } as never;
	}

	it('reads files at the given ref', async () => {
		const ctx = createRemoteDetectionContext(
			clientReturning({ 'package.json': '{"name":"x"}' }),
			target,
			'main'
		);

		await expect(ctx.readFile('package.json')).resolves.toBe('{"name":"x"}');
		await expect(ctx.fileExists('package.json')).resolves.toBe(true);
		await expect(ctx.fileExists('deno.json')).resolves.toBe(false);
	});

	it('prefixes paths with rootDir for a monorepo', async () => {
		const client = clientReturning({ 'apps/web/package.json': '{}' });
		const ctx = createRemoteDetectionContext(client, target, 'main', 'apps/web');

		await expect(ctx.fileExists('package.json')).resolves.toBe(true);
	});

	it('fetches each path only once', async () => {
		const client = clientReturning({ 'package.json': '{}' });
		const ctx = createRemoteDetectionContext(client, target, 'main');

		await ctx.readFile('package.json');
		await ctx.fileExists('package.json');
		await ctx.readFile('package.json');

		expect(
			(client as unknown as { getFileContents: ReturnType<typeof vi.fn> }).getFileContents
		).toHaveBeenCalledTimes(1);
	});

	it('treats a provider failure as a missing file', async () => {
		const getFileContents = vi.fn().mockRejectedValue(new Error('rate limited'));
		const ctx = createRemoteDetectionContext({ getFileContents } as never, target, 'main');

		await expect(ctx.readFile('package.json')).resolves.toBeNull();
	});
});
