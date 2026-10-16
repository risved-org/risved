import type { ProjectRuntime } from '$lib/project-runtime'
import type { FrameworkId, Tier } from '../detection/types'

/** Supported lockfile types for auto-detecting package manager */
export type Lockfile =
	| 'package-lock.json'
	| 'bun.lockb'
	| 'bun.lock'
	| 'pnpm-lock.yaml'
	| 'yarn.lock'
	| null

/** Options for generating a Dockerfile */
export interface DockerfileOptions {
	/** Detected or overridden framework */
	frameworkId: FrameworkId
	/** Runtime tier from detection */
	tier: Tier
	/** Port the app listens on inside the container */
	port?: number
	/** Custom install command override (default: auto-detected from lockfile) */
	installCommand?: string
	/** Custom build command override (default: npm run build) */
	buildCommand?: string
	/** Server runtime; omitted values preserve the framework default. */
	runtime?: ProjectRuntime
	/** Custom start/serve command override (default: framework-specific) */
	startCommand?: string
	/** Detected lockfile in the project root */
	lockfile?: Lockfile
	/** Yarn release line (only relevant when lockfile === 'yarn.lock') */
	yarnVersion?: 'classic' | 'berry'
	/** Framework-specific metadata from detection (e.g. nuxt2 srcDir) */
	meta?: Record<string, string>
	/** The pipeline injected a build-time .env that must stay out of the runtime image */
	stripBuildEnv?: boolean
}

/** Result of Dockerfile generation */
export interface DockerfileResult {
	/** The generated Dockerfile content */
	content: string
	/** Framework used for generation */
	frameworkId: FrameworkId
	/** Tier used for generation */
	tier: Tier
}

/** Framework-specific build configuration */
export interface FrameworkBuildConfig {
	/** Directory where build output lands */
	outputDir: string
	/** Default build command */
	buildCommand: string
	/** Default install command */
	installCommand: string
	/** Entrypoint command for serving */
	serveCommand: string
	/** Files/dirs to copy to the runtime stage */
	copyPaths: string[]
	/** Required server output, checked after build before creating a runtime image. */
	requiredServerFile?: string
	/** Node major used by both builder and runtime. */
	nodeVersion?: 22 | 24
	/** Working directory for the production entrypoint. */
	runtimeWorkdir?: string
	/** Default server environment, overridable by project settings. */
	runtimeEnv?: Record<string, string>
}

/** Map of framework IDs to their build configurations */
export type FrameworkConfigs = Record<FrameworkId, FrameworkBuildConfig>
