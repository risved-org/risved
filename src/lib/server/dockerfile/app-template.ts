import { BUN_VERSION } from '$lib/project-runtime'
import type { DockerfileOptions, FrameworkBuildConfig } from './types'
import type { AppWorkspace } from '../workspace'
import { buildCommand, installCommand, type DetectionResult } from '../detect-package-manager'

/** Quote repository paths and package names for generated shell commands. */
function quote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** Build an application while preserving workspace links and runtime dependencies. */
export function appTemplate(
	config: FrameworkBuildConfig,
	options: DockerfileOptions,
	workspace: AppWorkspace,
	manager: DetectionResult
): string {
	const app = `/app/${workspace.app}`
	const root = workspace.root ? `/app/${workspace.root}` : '/app'
	const runtime = options.runtime ?? 'node'
	const nodeVersion = config.nodeVersion ?? 22
	const bunImage = `oven/bun:${BUN_VERSION}-debian`
	const install = manager.lockfile ? installCommand(manager) : 'npm install'
	const lines = [
		`FROM risved-node-build:${nodeVersion} AS build`,
		...(runtime === 'bun' ? [`COPY --from=${bunImage} /usr/local/bin/bun /usr/local/bin/bun`] : []),
		'WORKDIR /app',
		'COPY . .',
		`WORKDIR ${JSON.stringify(root)}`,
		...(manager.yarnVersion === 'berry' ? ['ENV YARN_NODE_LINKER=node-modules'] : []),
		`RUN ${options.installCommand || install}`
	]
	for (const pkg of workspace.buildPackages) {
		const selected = pkg.path === workspace.app
		if (selected && options.buildCommand) continue
		if (!pkg.manifest.scripts?.build) continue
		const command =
			manager.packageManager === 'bun' && pkg.manifest.name && workspace.root !== workspace.app
				? `cd ${quote(root)} && bun run --filter ${quote(pkg.manifest.name)} build`
				: `cd ${quote(`/app/${pkg.path}`)} && ${buildCommand(manager)}`
		lines.push(`RUN ${command}`)
	}
	lines.push(`WORKDIR ${JSON.stringify(app)}`)
	if (options.buildCommand) lines.push(`RUN ${options.buildCommand}`)
	lines.push(`WORKDIR ${JSON.stringify(app)}`)
	if (config.requiredServerFile) {
		lines.push(
			`RUN test -f ${quote(config.requiredServerFile)} || (echo \"Missing ${config.requiredServerFile}: enable SSR or configure a custom start command for your output.\" >&2; exit 1)`
		)
	}
	// Keep the release target's environment, but remove it from every runtime layer.
	lines.push('FROM build AS output')
	if (options.stripBuildEnv) lines.push(`RUN : > ${quote(`${app}/.env`)}`)
	let start = options.startCommand || config.serveCommand
	if (options.frameworkId === 'nextjs' && !options.startCommand) {
		const standalone = `.next/standalone/${workspace.app}`
		lines.push(
			`RUN if [ -f ${quote(`${standalone}/server.js`)} ]; then mkdir -p ${quote(`${standalone}/.next`)} && cp -R .next/static ${quote(`${standalone}/.next/static`)} && if [ -d public ]; then cp -R public ${quote(`${standalone}/public`)}; fi; fi`
		)
		start = `if [ -f ${quote(`${standalone}/server.js`)} ]; then ${runtime === 'bun' ? 'bun' : 'node'} ${quote(`${standalone}/server.js`)}; else ${runtime === 'bun' ? 'bun' : 'node'} .next/standalone/server.js; fi`
	}
	lines.push(
		`FROM ${runtime === 'bun' ? bunImage : `node:${nodeVersion}-slim`} AS runtime`,
		...Object.entries(config.runtimeEnv ?? {}).map(([key, value]) => `ENV ${key}=${value}`),
		'COPY --from=output /app /app',
		`WORKDIR ${JSON.stringify(config.runtimeWorkdir?.replace(/^\/app(?=\/|$)/, app) ?? app)}`,
		'RUN mkdir -p /app/data && chmod 777 /app/data',
		`EXPOSE ${options.port ?? 8000}`,
		`CMD ${JSON.stringify(['sh', '-c', start])}`,
		''
	)
	return lines.join('\n')
}
