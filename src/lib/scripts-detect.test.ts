import { describe, it, expect } from 'vitest';
import { detectPackageManager, detectScripts, resolveScriptCommand } from './scripts-detect';

describe('detectPackageManager', () => {
	it('defaults to npm when no lockfiles present', () => {
		const result = detectPackageManager([]);
		expect(result.packageManager).toBe('npm');
		expect(result.lockfile).toBeNull();
		expect(result.warning).toBeNull();
	});

	it('picks bun for bun.lockb', () => {
		const result = detectPackageManager([{ name: 'bun.lockb' }]);
		expect(result.packageManager).toBe('bun');
		expect(result.lockfile).toBe('bun.lockb');
		expect(result.warning).toBeNull();
	});

	it('picks bun for bun.lock', () => {
		expect(detectPackageManager([{ name: 'bun.lock' }]).packageManager).toBe('bun');
	});

	it('picks pnpm for pnpm-lock.yaml', () => {
		expect(detectPackageManager([{ name: 'pnpm-lock.yaml' }]).packageManager).toBe('pnpm');
	});

	it('picks yarn for yarn.lock', () => {
		expect(detectPackageManager([{ name: 'yarn.lock' }]).packageManager).toBe('yarn');
	});

	it('picks npm for package-lock.json', () => {
		expect(detectPackageManager([{ name: 'package-lock.json' }]).packageManager).toBe('npm');
	});

	it('warns when multiple lockfiles are present, picking the most recent', () => {
		const result = detectPackageManager([
			{ name: 'package-lock.json', modifiedAt: '2026-01-01T00:00:00Z' },
			{ name: 'bun.lock', modifiedAt: '2026-02-01T00:00:00Z' }
		]);
		expect(result.packageManager).toBe('bun');
		expect(result.lockfile).toBe('bun.lock');
		expect(result.warning).toContain('Multiple lockfiles detected');
		expect(result.warning).toContain('package-lock.json');
		expect(result.warning).toContain('bun.lock');
	});

	it('falls back to priority order when modifiedAt is unavailable', () => {
		const result = detectPackageManager([{ name: 'package-lock.json' }, { name: 'bun.lockb' }]);
		expect(result.packageManager).toBe('bun');
		expect(result.warning).not.toBeNull();
	});
});

describe('resolveScriptCommand', () => {
	it('prefixes each manager correctly', () => {
		expect(resolveScriptCommand('migrate', 'bun')).toBe('bun run migrate');
		expect(resolveScriptCommand('migrate', 'pnpm')).toBe('pnpm run migrate');
		expect(resolveScriptCommand('migrate', 'yarn')).toBe('yarn migrate');
		expect(resolveScriptCommand('migrate', 'npm')).toBe('npm run migrate');
	});
});

describe('detectScripts', () => {
	it('returns empty result when package.json is missing', () => {
		const result = detectScripts(null, []);
		expect(result.empty).toBe(true);
		expect(result.suggestions).toEqual([]);
	});

	it('returns empty result when scripts field is absent', () => {
		const result = detectScripts(JSON.stringify({ name: 'app' }), []);
		expect(result.empty).toBe(true);
		expect(result.suggestions).toEqual([]);
	});

	it('returns empty result when JSON is invalid', () => {
		const result = detectScripts('{not valid', []);
		expect(result.empty).toBe(true);
	});

	it('prioritises migration-shaped scripts and labels them', () => {
		const pkg = JSON.stringify({
			scripts: {
				dev: 'vite',
				build: 'vite build',
				migrate: 'drizzle-kit migrate',
				'db:push': 'drizzle-kit push',
				test: 'vitest'
			}
		});
		const result = detectScripts(pkg, [{ name: 'bun.lockb' }]);

		expect(result.empty).toBe(false);
		/* Migration-shaped scripts appear first. */
		expect(result.suggestions[0].name).toBe('migrate');
		expect(result.suggestions[0].migrationShaped).toBe(true);
		expect(result.suggestions[0].label).toBe('Looks like a migration script');
		expect(result.suggestions[1].name).toBe('db:push');
		expect(result.suggestions[1].migrationShaped).toBe(true);

		/* Non-migration scripts come after. */
		const nonMigration = result.suggestions.slice(2);
		expect(nonMigration.map((s) => s.name)).toEqual(['dev', 'build', 'test']);
		for (const s of nonMigration) {
			expect(s.migrationShaped).toBe(false);
			expect(s.label).toBeUndefined();
		}
	});

	it('recognises all migration-shaped script names', () => {
		const pkg = JSON.stringify({
			scripts: {
				migrate: 'x',
				'db:migrate': 'x',
				'db:deploy': 'x',
				'db:push': 'x',
				release: 'x'
			}
		});
		const result = detectScripts(pkg, []);
		expect(result.suggestions.every((s) => s.migrationShaped)).toBe(true);
		expect(result.suggestions).toHaveLength(5);
	});

	it('resolves commands using the detected package manager', () => {
		const pkg = JSON.stringify({ scripts: { migrate: 'drizzle-kit migrate' } });

		const bun = detectScripts(pkg, [{ name: 'bun.lockb' }]);
		expect(bun.suggestions[0].command).toBe('bun run migrate');

		const yarn = detectScripts(pkg, [{ name: 'yarn.lock' }]);
		expect(yarn.suggestions[0].command).toBe('yarn migrate');

		const pnpm = detectScripts(pkg, [{ name: 'pnpm-lock.yaml' }]);
		expect(pnpm.suggestions[0].command).toBe('pnpm run migrate');

		const npm = detectScripts(pkg, []);
		expect(npm.suggestions[0].command).toBe('npm run migrate');
	});

	it('propagates the multi-lockfile warning', () => {
		const pkg = JSON.stringify({ scripts: { migrate: 'x' } });
		const result = detectScripts(pkg, [{ name: 'yarn.lock' }, { name: 'bun.lock' }]);
		expect(result.warning).toContain('Multiple lockfiles detected');
	});

	it('does not infer commands from ORM-specific files — only reads package.json', () => {
		/* Guarantee: detection never branches on drizzle.config.ts, prisma/schema.prisma, etc. */
		const pkg = JSON.stringify({ scripts: {} });
		const result = detectScripts(pkg, []);
		expect(result.suggestions).toEqual([]);
	});
});
