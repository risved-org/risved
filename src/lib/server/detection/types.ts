/** Supported framework identifiers */
export type FrameworkId =
	| 'sveltekit'
	| 'fresh'
	| 'astro'
	| 'hono'
	| 'nextjs'
	| 'nuxt'
	| 'lume'
	| 'solidstart'
	| 'tanstack-start'
	| 'generic';

/** Runtime tier determines Docker strategy */
export type Tier = 'deno' | 'hybrid' | 'node';

/** How confident the detection is */
export type Confidence = 'high' | 'medium' | 'low';

export interface FrameworkResult {
	id: FrameworkId;
	name: string;
	tier: Tier;
	confidence: Confidence;
}

export interface DetectionResult {
	detected: boolean;
	framework: FrameworkResult | null;
}

export interface FrameworkDetector {
	id: FrameworkId;
	name: string;
	tier: Tier;
	/** Run detection against a project directory. Returns confidence or null if not detected. */
	detect(ctx: DetectionContext): Promise<Confidence | null>;
}

export interface DetectionContext {
	/** Check if a file exists relative to the project root */
	fileExists(path: string): Promise<boolean>;
	/** Read a file's content relative to the project root. Returns null if not found. */
	readFile(path: string): Promise<string | null>;
}
