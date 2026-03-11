import type { FrameworkId, Tier } from '../detection/types';

/** Options for generating a Dockerfile */
export interface DockerfileOptions {
	/** Detected or overridden framework */
	frameworkId: FrameworkId;
	/** Runtime tier from detection */
	tier: Tier;
	/** Port the app listens on inside the container */
	port?: number;
	/** Custom install command override (default: npm ci) */
	installCommand?: string;
	/** Custom build command override (default: npm run build) */
	buildCommand?: string;
}

/** Result of Dockerfile generation */
export interface DockerfileResult {
	/** The generated Dockerfile content */
	content: string;
	/** Framework used for generation */
	frameworkId: FrameworkId;
	/** Tier used for generation */
	tier: Tier;
}

/** Framework-specific build configuration */
export interface FrameworkBuildConfig {
	/** Directory where build output lands */
	outputDir: string;
	/** Default build command */
	buildCommand: string;
	/** Default install command */
	installCommand: string;
	/** Entrypoint command for serving */
	serveCommand: string;
	/** Files/dirs to copy to the runtime stage */
	copyPaths: string[];
	/** Additional Deno permissions (for deno/hybrid tiers) */
	denoPermissions?: string;
}

/** Map of framework IDs to their build configurations */
export type FrameworkConfigs = Record<FrameworkId, FrameworkBuildConfig>;
