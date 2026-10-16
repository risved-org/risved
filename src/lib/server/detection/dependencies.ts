import type { DetectionContext } from './types'

/**
 * Check if a package.json contains a dependency (in deps or devDeps).
 * Returns null if package.json doesn't exist or can't be parsed.
 */
export async function hasDependency(ctx: DetectionContext, pkg: string): Promise<boolean> {
	const content = await ctx.readFile('package.json')
	if (!content) return false

	try {
		const json = JSON.parse(content)
		const deps = json.dependencies ?? {}
		const devDeps = json.devDependencies ?? {}
		return pkg in deps || pkg in devDeps
	} catch {
		return false
	}
}
