/**
 * Filesystem-based package manager detection.
 *
 * Run at deploy time against a checked-out repo and at onboarding time against
 * a temp clone. Returns the same shape from both call sites — never cached.
 *
 * Priority order (first match wins):
 *   bun.lockb/bun.lock → pnpm-lock.yaml → yarn.lock → package-lock.json → npm default.
 *
 * When multiple lockfiles exist, the most recently modified one is picked and
 * a warning is emitted naming all of them.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type Lockfile =
	| 'bun.lockb'
	| 'bun.lock'
	| 'pnpm-lock.yaml'
	| 'yarn.lock'
	| 'package-lock.json';

/** Priority order used as the tiebreaker when mtimes are equal or missing. */
const LOCKFILE_PRIORITY: Lockfile[] = [
	'bun.lockb',
	'bun.lock',
	'pnpm-lock.yaml',
	'yarn.lock',
	'package-lock.json'
];

export interface DetectionResult {
	packageManager: PackageManager;
	/** The lockfile the decision is based on. Null when no lockfile is present. */
	lockfile: Lockfile | null;
	/** Only set when packageManager === 'yarn'. */
	yarnVersion?: 'classic' | 'berry';
	/** Human-readable warnings (e.g. multiple lockfiles present). */
	warnings: string[];
	/** Every lockfile found in the repo root, in priority order. */
	lockfilesFound: Lockfile[];
}

/**
 * Inspect the filesystem at `repoRoot` and determine the package manager.
 * Safe on directories with no package.json — returns npm as the default.
 */
export async function detectPackageManager(repoRoot: string): Promise<DetectionResult> {
	const found: { name: Lockfile; mtimeMs: number }[] = [];

	for (const name of LOCKFILE_PRIORITY) {
		try {
			const s = await stat(join(repoRoot, name));
			if (s.isFile()) found.push({ name, mtimeMs: s.mtimeMs });
		} catch {
			/* not present */
		}
	}

	if (found.length === 0) {
		return {
			packageManager: 'npm',
			lockfile: null,
			warnings: [],
			lockfilesFound: []
		};
	}

	let picked: Lockfile;
	const warnings: string[] = [];

	if (found.length === 1) {
		picked = found[0].name;
	} else {
		/* Most recently modified wins; priority order is the tiebreaker. */
		const sorted = [...found].sort((a, b) => {
			if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
			return LOCKFILE_PRIORITY.indexOf(a.name) - LOCKFILE_PRIORITY.indexOf(b.name);
		});
		picked = sorted[0].name;
		const list = LOCKFILE_PRIORITY.filter((l) => found.some((f) => f.name === l)).join(', ');
		warnings.push(
			`Multiple lockfiles detected: ${list}. We'll use ${packageManagerFor(picked)} (most recently modified). Please remove unused lockfiles to avoid confusion.`
		);
	}

	const packageManager = packageManagerFor(picked);

	const result: DetectionResult = {
		packageManager,
		lockfile: picked,
		warnings,
		lockfilesFound: LOCKFILE_PRIORITY.filter((l) => found.some((f) => f.name === l))
	};

	if (packageManager === 'yarn') {
		result.yarnVersion = (await fileExists(join(repoRoot, '.yarnrc.yml'))) ? 'berry' : 'classic';
	}

	return result;
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

async function fileExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}

/**
 * Frozen-lockfile install command for the detected package manager.
 * Yarn Berry uses `--immutable`; Classic uses `--frozen-lockfile`.
 */
export function installCommand(result: DetectionResult): string {
	switch (result.packageManager) {
		case 'npm':
			return 'npm ci';
		case 'pnpm':
			return 'pnpm install --frozen-lockfile';
		case 'bun':
			return 'bun install --frozen-lockfile';
		case 'yarn':
			return result.yarnVersion === 'berry'
				? 'yarn install --immutable'
				: 'yarn install --frozen-lockfile';
	}
}

/**
 * `<pm> run <script>` (yarn omits `run` per its own convention).
 */
export function buildCommand(result: DetectionResult, script = 'build'): string {
	switch (result.packageManager) {
		case 'yarn':
			return `yarn ${script}`;
		case 'npm':
			return `npm run ${script}`;
		case 'pnpm':
			return `pnpm run ${script}`;
		case 'bun':
			return `bun run ${script}`;
	}
}

/**
 * Prune command that leaves only production dependencies in node_modules.
 * Used for frameworks that ship node_modules to the runtime stage.
 */
export function pruneCommand(result: DetectionResult): string {
	switch (result.packageManager) {
		case 'npm':
			return 'npm prune --omit=dev';
		case 'pnpm':
			return 'pnpm prune --prod';
		case 'yarn':
			return result.yarnVersion === 'berry'
				? 'yarn workspaces focus --production --all'
				: 'yarn install --production --ignore-scripts';
		case 'bun':
			return 'rm -rf node_modules && bun install --frozen-lockfile --production';
	}
}
