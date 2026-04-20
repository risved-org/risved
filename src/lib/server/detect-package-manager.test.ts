import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, utimes, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	detectPackageManager,
	installCommand,
	buildCommand,
	pruneCommand
} from './detect-package-manager';

let repoRoot: string;

beforeEach(async () => {
	repoRoot = await mkdtemp(join(tmpdir(), 'risved-detect-pm-'));
});

afterEach(async () => {
	await rm(repoRoot, { recursive: true, force: true });
});

async function touch(name: string, content = '', mtimeEpoch?: number): Promise<void> {
	const path = join(repoRoot, name);
	await writeFile(path, content);
	if (mtimeEpoch !== undefined) {
		await utimes(path, mtimeEpoch, mtimeEpoch);
	}
}

describe('detectPackageManager (fs)', () => {
	it('defaults to npm when no lockfile is present', async () => {
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('npm');
		expect(result.lockfile).toBeNull();
		expect(result.warnings).toEqual([]);
		expect(result.lockfilesFound).toEqual([]);
	});

	it('detects Bun from bun.lockb', async () => {
		await touch('bun.lockb', 'binary');
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('bun');
		expect(result.lockfile).toBe('bun.lockb');
		expect(result.warnings).toEqual([]);
	});

	it('detects Bun from bun.lock', async () => {
		await touch('bun.lock', '');
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('bun');
		expect(result.lockfile).toBe('bun.lock');
	});

	it('detects pnpm from pnpm-lock.yaml', async () => {
		await touch('pnpm-lock.yaml', '');
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('pnpm');
		expect(result.lockfile).toBe('pnpm-lock.yaml');
	});

	it('detects Yarn Classic with yarn.lock and no .yarnrc.yml', async () => {
		await touch('yarn.lock', '');
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('yarn');
		expect(result.yarnVersion).toBe('classic');
	});

	it('detects Yarn Berry when .yarnrc.yml is also present', async () => {
		await touch('yarn.lock', '');
		await touch('.yarnrc.yml', 'nodeLinker: node-modules\n');
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('yarn');
		expect(result.yarnVersion).toBe('berry');
	});

	it('detects npm from package-lock.json', async () => {
		await touch('package-lock.json', '{}');
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('npm');
		expect(result.lockfile).toBe('package-lock.json');
	});

	it('warns when multiple lockfiles exist, picks most recently modified', async () => {
		await touch('package-lock.json', '{}', 1_700_000_000);
		await touch('bun.lock', '', 1_800_000_000);

		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('bun');
		expect(result.lockfile).toBe('bun.lock');
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('Multiple lockfiles detected');
		expect(result.warnings[0]).toContain('bun.lock');
		expect(result.warnings[0]).toContain('package-lock.json');
		expect(result.lockfilesFound).toEqual(['bun.lock', 'package-lock.json']);
	});

	it('uses priority order as tiebreaker when mtimes are equal', async () => {
		await touch('package-lock.json', '{}', 1_700_000_000);
		await touch('pnpm-lock.yaml', '', 1_700_000_000);

		const result = await detectPackageManager(repoRoot);
		/* pnpm outranks npm in priority. */
		expect(result.packageManager).toBe('pnpm');
		expect(result.warnings).toHaveLength(1);
	});

	it('lists lockfilesFound in priority order regardless of mtime', async () => {
		await touch('bun.lockb', 'x', 1_000);
		await touch('yarn.lock', '', 9_999);

		const result = await detectPackageManager(repoRoot);
		expect(result.lockfilesFound).toEqual(['bun.lockb', 'yarn.lock']);
	});

	it('does not treat a directory named like a lockfile as a lockfile', async () => {
		/* Edge case: user accidentally created a directory `yarn.lock`. */
		await mkdir(join(repoRoot, 'yarn.lock'));
		const result = await detectPackageManager(repoRoot);
		expect(result.packageManager).toBe('npm');
		expect(result.lockfile).toBeNull();
	});
});

describe('installCommand', () => {
	it('returns npm ci for npm', () => {
		expect(
			installCommand({
				packageManager: 'npm',
				lockfile: 'package-lock.json',
				warnings: [],
				lockfilesFound: ['package-lock.json']
			})
		).toBe('npm ci');
	});

	it('returns pnpm install --frozen-lockfile for pnpm', () => {
		expect(
			installCommand({
				packageManager: 'pnpm',
				lockfile: 'pnpm-lock.yaml',
				warnings: [],
				lockfilesFound: ['pnpm-lock.yaml']
			})
		).toBe('pnpm install --frozen-lockfile');
	});

	it('returns yarn install --frozen-lockfile for Yarn Classic', () => {
		expect(
			installCommand({
				packageManager: 'yarn',
				yarnVersion: 'classic',
				lockfile: 'yarn.lock',
				warnings: [],
				lockfilesFound: ['yarn.lock']
			})
		).toBe('yarn install --frozen-lockfile');
	});

	it('returns yarn install --immutable for Yarn Berry', () => {
		expect(
			installCommand({
				packageManager: 'yarn',
				yarnVersion: 'berry',
				lockfile: 'yarn.lock',
				warnings: [],
				lockfilesFound: ['yarn.lock']
			})
		).toBe('yarn install --immutable');
	});

	it('returns bun install --frozen-lockfile for bun', () => {
		expect(
			installCommand({
				packageManager: 'bun',
				lockfile: 'bun.lockb',
				warnings: [],
				lockfilesFound: ['bun.lockb']
			})
		).toBe('bun install --frozen-lockfile');
	});
});

describe('buildCommand', () => {
	const npm = {
		packageManager: 'npm' as const,
		lockfile: 'package-lock.json' as const,
		warnings: [],
		lockfilesFound: ['package-lock.json' as const]
	};

	it('formats npm correctly', () => {
		expect(buildCommand(npm, 'build')).toBe('npm run build');
	});

	it('omits "run" for yarn', () => {
		expect(
			buildCommand(
				{
					packageManager: 'yarn',
					yarnVersion: 'classic',
					lockfile: 'yarn.lock',
					warnings: [],
					lockfilesFound: ['yarn.lock']
				},
				'migrate'
			)
		).toBe('yarn migrate');
	});

	it('defaults script name to build', () => {
		expect(buildCommand(npm)).toBe('npm run build');
	});
});

describe('pruneCommand', () => {
	it('uses the production flag for each manager', () => {
		expect(pruneCommand({ packageManager: 'npm', lockfile: null, warnings: [], lockfilesFound: [] })).toBe(
			'npm prune --omit=dev'
		);
		expect(
			pruneCommand({
				packageManager: 'pnpm',
				lockfile: 'pnpm-lock.yaml',
				warnings: [],
				lockfilesFound: ['pnpm-lock.yaml']
			})
		).toBe('pnpm prune --prod');
		expect(
			pruneCommand({
				packageManager: 'yarn',
				yarnVersion: 'berry',
				lockfile: 'yarn.lock',
				warnings: [],
				lockfilesFound: ['yarn.lock']
			})
		).toContain('focus');
		expect(
			pruneCommand({
				packageManager: 'bun',
				lockfile: 'bun.lockb',
				warnings: [],
				lockfilesFound: ['bun.lockb']
			})
		).toContain('bun install');
	});
});
