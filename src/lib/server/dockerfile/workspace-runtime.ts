import { quoteShell } from './shell'
import { dirname } from 'node:path'
import type { DockerfileOptions, FrameworkBuildConfig } from './types'

/** Resolve explicit framework CLI paths from the app through the repository root. */
function executableCommand(command: string, app: string): string {
	const cli = /^(?:(node|bun) )?(node_modules\/\S+)(.*)$/.exec(command)
	if (!cli) return command
	const [, interpreter, executable, args] = cli
	const candidates: string[] = []
	let directory = app
	while (directory.startsWith('/app')) {
		const path = quoteShell(`${directory}/${executable}`)
		candidates.push(
			`if [ -f ${path} ]; then exec ${interpreter ? `${interpreter} ` : ''}${path}${args}; fi`
		)
		if (directory === '/app') break
		directory = dirname(directory)
	}
	return `${candidates.join('; ')}; echo 'Framework executable not found in workspace' >&2; exit 1`
}

/** Prepare assets and startup commands for either Next standalone layout or a hoisted CLI. */
export function workspaceRuntime(
	config: FrameworkBuildConfig,
	options: DockerfileOptions,
	app: string
): { outputCommands: string[]; startCommand: string } {
	if (options.startCommand) return { outputCommands: [], startCommand: options.startCommand }
	if (options.frameworkId !== 'nextjs') {
		return { outputCommands: [], startCommand: executableCommand(config.serveCommand, app) }
	}
	const nested = `.next/standalone/${app.slice('/app/'.length)}`
	const select = `standalone=${quoteShell(nested)}; if [ ! -f "$standalone/server.js" ]; then standalone='.next/standalone'; fi`
	const runtime = options.runtime === 'bun' ? 'bun' : 'node'
	return {
		outputCommands: [
			`RUN ${select}; test -f "$standalone/server.js" && mkdir -p "$standalone/.next" && cp -R .next/static "$standalone/.next/" && if [ -d public ]; then cp -R public "$standalone/"; fi`
		],
		startCommand: `${select}; exec ${runtime} "$standalone/server.js"`
	}
}
