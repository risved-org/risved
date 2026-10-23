import type { BuildHint, BuildHintSeverity } from './hints'

/** A build-log pattern and the hint it maps to. */
interface LogPattern {
	pattern: RegExp
	hint: Omit<BuildHint, 'severity'> & { severity?: BuildHintSeverity }
}

const LOG_PATTERNS: LogPattern[] = [
	{
		pattern: /Cannot find module ['"]?\/app\/build\/index\.js|build\/index\.js.*not found/i,
		hint: {
			code: 'missing_adapter_node',
			message: 'The container could not find build/index.js, which adapter-node produces.',
			fix: 'bun add -D @sveltejs/adapter-node and use it in svelte.config.js',
			docsUrl: 'https://svelte.dev/docs/kit/adapter-node'
		}
	},
	{
		pattern: /\.next\/standalone.*(no such file|not found)|Cannot find module.*server\.js/i,
		hint: {
			code: 'missing_nextjs_standalone',
			message: 'The Next.js standalone output is missing, so the container has no server.js.',
			fix: "Set output: 'standalone' in next.config.js.",
			file: 'next.config.js'
		}
	},
	{
		pattern: /npm ci.*can only install packages when.*lock|npm ERR!.*package-lock\.json/i,
		hint: {
			code: 'missing_lockfile',
			message: '`npm ci` needs a lockfile that matches package.json.',
			fix: 'Run npm install and commit the updated package-lock.json.'
		}
	},
	{
		pattern: /missing script:\s*build|npm ERR! Missing script: "build"/i,
		hint: {
			code: 'missing_build_script',
			message: 'The build failed because package.json has no "build" script.',
			fix: 'Add a "build" script to package.json.',
			file: 'package.json'
		}
	},
	{
		pattern: /error TS\d+|Type error:/,
		hint: {
			code: 'typescript_error',
			message: 'The build failed on a TypeScript error.',
			fix: 'Fix the reported type error, or relax the check that rejects it.'
		}
	},
	{
		pattern: /JavaScript heap out of memory|Killed\s*$|exit code 137/im,
		hint: {
			code: 'build_out_of_memory',
			message: 'The build process ran out of memory and was killed.',
			fix: 'Raise NODE_OPTIONS=--max-old-space-size, or trim the build.'
		}
	},
	{
		pattern: /Health check timed out/i,
		hint: {
			code: 'health_check_timeout',
			message: 'The container started but never answered the health check.',
			fix: 'Listen on 0.0.0.0 and the PORT environment variable, and serve 200 on /.'
		}
	},
	{
		pattern: /Authentication failed|could not read Username|Permission denied \(publickey\)/i,
		hint: {
			code: 'git_auth_failed',
			message: 'The repository could not be cloned with the stored credentials.',
			fix: 'Reconnect the Git provider under Settings → Git, or add the deploy key to the repo.'
		}
	},
	{
		pattern: /EADDRINUSE|address already in use/i,
		hint: {
			code: 'port_in_use',
			message: 'The app tried to bind a port that is already taken inside the container.',
			fix: 'Bind the PORT environment variable rather than a hard-coded port.'
		}
	},
	{
		pattern: /release command failed|release exited with code [1-9]/i,
		hint: {
			code: 'release_command_failed',
			message: 'The release command failed, so traffic was never switched over.',
			fix: 'Run the release command locally against the same database and fix what it reports.'
		}
	}
]

/**
 * Derive hints from a deployment's build output.
 *
 * Only error/warn lines are scanned: an informational line that happens to
 * contain "error" in a filename should not raise a hint. Each code appears at
 * most once.
 */
export function hintsFromLogs(logs: Array<{ level: string; message: string }>): BuildHint[] {
	const relevant = logs.filter((l) => l.level === 'error' || l.level === 'warn')
	if (relevant.length === 0) return []

	const text = relevant.map((l) => l.message).join('\n')
	const seen = new Set<string>()
	const hints: BuildHint[] = []

	for (const { pattern, hint } of LOG_PATTERNS) {
		if (seen.has(hint.code)) continue
		if (!pattern.test(text)) continue
		seen.add(hint.code)
		hints.push({ severity: 'error', ...hint })
	}

	return hints
}
