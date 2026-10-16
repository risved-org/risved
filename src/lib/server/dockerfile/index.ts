import { runtimeError } from '$lib/project-runtime'
import { getFrameworkConfig } from './configs'
import { nodeTemplate } from './templates'
import type { DockerfileOptions, DockerfileResult } from './types'

export type { DockerfileOptions, DockerfileResult } from './types'
export type { FrameworkBuildConfig, FrameworkConfigs } from './types'
export { frameworkConfigs, getFrameworkConfig } from './configs'

const DEFAULT_PORT = 8000

/**
 * Generate a Dockerfile for a detected framework.
 */
export function generateDockerfile(options: DockerfileOptions): DockerfileResult {
	const {
		frameworkId,
		tier,
		port = DEFAULT_PORT,
		installCommand,
		buildCommand,
		startCommand,
		lockfile,
		yarnVersion,
		meta,
		stripBuildEnv
	} = options
	const runtime = options.runtime ?? 'node'
	const validationError = runtimeError(runtime, frameworkId, tier)
	if (validationError) throw new Error(validationError)
	let config = getFrameworkConfig(frameworkId)
	if (runtime === 'bun') {
		config = { ...config, serveCommand: config.serveCommand.replace(/^node /, 'bun ') }
	}

	/* Nuxt 2: replace 'static' in copyPaths with the actual srcDir-relative path */
	if (frameworkId === 'nuxt2') {
		const srcDir = meta?.srcDir
		if (srcDir) {
			config = {
				...config,
				copyPaths: config.copyPaths.map((p) => (p === 'static' ? `${srcDir}static` : p))
			}
		}
	}

	/* Apply startCommand override to the framework config's serveCommand */
	if (startCommand) {
		config = { ...config, serveCommand: startCommand, requiredServerFile: undefined }
	}

	let content: string

	switch (tier) {
		case 'node':
			content = nodeTemplate(
				config,
				port,
				installCommand,
				buildCommand,
				lockfile,
				yarnVersion,
				stripBuildEnv,
				runtime
			)
			break
		default:
			throw new Error(`Unknown tier: ${tier}`)
	}

	return { content, frameworkId, tier }
}
