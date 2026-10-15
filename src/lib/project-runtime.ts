export type ProjectRuntime = 'node' | 'bun'

export const BUN_VERSION = '1.3.14'

/** Whether the framework can use the optional Bun server runtime. */
export function supportsBun(frameworkId?: string | null, tier?: string | null): boolean {
	return (
		(!frameworkId || frameworkId === 'sveltekit' || frameworkId === 'generic') &&
		(!tier || tier === 'node')
	)
}

/** Validate saved and submitted runtime choices independently of package managers. */
export function runtimeError(
	runtime: unknown,
	frameworkId?: string | null,
	tier?: string | null
): string | null {
	if (runtime !== 'node' && runtime !== 'bun') return 'Choose Node.js or Bun as the runtime.'
	if (runtime === 'bun' && !supportsBun(frameworkId, tier)) {
		return 'Bun is currently supported for SvelteKit and generic JavaScript/TypeScript servers only.'
	}
	return null
}
