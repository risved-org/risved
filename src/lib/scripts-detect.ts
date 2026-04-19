/**
 * Onboarding-only detection of package manager + package.json scripts.
 *
 * Used to power release command suggestion chips in the UI.
 * This module MUST NOT affect runtime deploy behaviour — it is cosmetic.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type Lockfile =
	| 'bun.lockb'
	| 'bun.lock'
	| 'pnpm-lock.yaml'
	| 'yarn.lock'
	| 'package-lock.json';

/** Ordered priority: first match wins. */
const LOCKFILE_PRIORITY: Lockfile[] = [
	'bun.lockb',
	'bun.lock',
	'pnpm-lock.yaml',
	'yarn.lock',
	'package-lock.json'
];

const MIGRATION_SCRIPT_NAMES = new Set([
	'migrate',
	'db:migrate',
	'db:deploy',
	'db:push',
	'release'
]);

export interface DetectedLockfile {
	name: Lockfile;
	/** ISO timestamp of last modification. Used when resolving conflicts. */
	modifiedAt?: string | null;
}

export interface PackageManagerResult {
	packageManager: PackageManager;
	lockfile: Lockfile | null;
	/** Non-null when multiple lockfiles were present and the user should clean up. */
	warning: string | null;
}

export interface ScriptSuggestion {
	/** Script name as it appears in package.json. */
	name: string;
	/** The body of the script (from package.json). */
	body: string;
	/** Fully-resolved command string (e.g. `bun run migrate`). */
	command: string;
	/** True if the script name matches the migration heuristic. */
	migrationShaped: boolean;
	/** Optional label for migration-shaped scripts. */
	label?: string;
}

export interface DetectScriptsResult {
	packageManager: PackageManager;
	lockfile: Lockfile | null;
	/** Warning about multiple lockfiles; null when unambiguous. */
	warning: string | null;
	/** Prioritised suggestions: migration-shaped first, then the rest. */
	suggestions: ScriptSuggestion[];
	/** True if no package.json was found. */
	empty: boolean;
}

/**
 * Pick the package manager from the presence of lockfiles.
 * When multiple lockfiles exist, return a warning naming them and
 * pick the most recently modified.
 */
export function detectPackageManager(lockfiles: DetectedLockfile[]): PackageManagerResult {
	if (lockfiles.length === 0) {
		return { packageManager: 'npm', lockfile: null, warning: null };
	}

	if (lockfiles.length === 1) {
		return {
			packageManager: packageManagerFor(lockfiles[0].name),
			lockfile: lockfiles[0].name,
			warning: null
		};
	}

	/* Multiple lockfiles: pick most recently modified, warn the user. */
	const sorted = [...lockfiles].sort((a, b) => {
		const at = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
		const bt = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
		if (at !== bt) return bt - at;
		/* Fall back to priority order. */
		return LOCKFILE_PRIORITY.indexOf(a.name) - LOCKFILE_PRIORITY.indexOf(b.name);
	});

	const picked = sorted[0];
	const names = lockfiles.map((l) => l.name).join(', ');
	return {
		packageManager: packageManagerFor(picked.name),
		lockfile: picked.name,
		warning: `Multiple lockfiles detected: ${names}. Please remove unused ones.`
	};
}

function packageManagerFor(lockfile: Lockfile): PackageManager {
	switch (lockfile) {
		case 'bun.lockb':
		case 'bun.lock':
			return 'bun';
		case 'pnpm-lock.yaml':
			return 'pnpm';
		case 'yarn.lock':
			return 'yarn';
		case 'package-lock.json':
			return 'npm';
	}
}

/**
 * Resolve a script name into the fully-qualified shell command.
 * e.g. ('migrate', 'bun') → 'bun run migrate'.
 * yarn omits `run` for convenience.
 */
export function resolveScriptCommand(scriptName: string, pm: PackageManager): string {
	switch (pm) {
		case 'bun':
			return `bun run ${scriptName}`;
		case 'pnpm':
			return `pnpm run ${scriptName}`;
		case 'yarn':
			return `yarn ${scriptName}`;
		case 'npm':
			return `npm run ${scriptName}`;
	}
}

/**
 * Parse a package.json `scripts` field and produce ordered suggestions.
 * Accepts a raw package.json string OR the parsed scripts object.
 * Migration-shaped names come first, labelled; the rest unlabelled.
 */
export function detectScripts(
	packageJsonRaw: string | null,
	lockfiles: DetectedLockfile[]
): DetectScriptsResult {
	const pmResult = detectPackageManager(lockfiles);

	if (!packageJsonRaw) {
		return {
			packageManager: pmResult.packageManager,
			lockfile: pmResult.lockfile,
			warning: pmResult.warning,
			suggestions: [],
			empty: true
		};
	}

	let scripts: Record<string, string> = {};
	try {
		const parsed = JSON.parse(packageJsonRaw);
		if (parsed && typeof parsed.scripts === 'object' && parsed.scripts !== null) {
			scripts = parsed.scripts;
		}
	} catch {
		/* Invalid JSON — treat as no scripts. */
	}

	const entries = Object.entries(scripts).filter(
		([name, body]) => typeof name === 'string' && typeof body === 'string'
	);

	const migration: ScriptSuggestion[] = [];
	const other: ScriptSuggestion[] = [];

	for (const [name, body] of entries) {
		const migrationShaped = MIGRATION_SCRIPT_NAMES.has(name);
		const suggestion: ScriptSuggestion = {
			name,
			body,
			command: resolveScriptCommand(name, pmResult.packageManager),
			migrationShaped,
			...(migrationShaped ? { label: 'Looks like a migration script' } : {})
		};
		if (migrationShaped) migration.push(suggestion);
		else other.push(suggestion);
	}

	return {
		packageManager: pmResult.packageManager,
		lockfile: pmResult.lockfile,
		warning: pmResult.warning,
		suggestions: [...migration, ...other],
		empty: entries.length === 0
	};
}
