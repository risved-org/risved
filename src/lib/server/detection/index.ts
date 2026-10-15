import { detectors } from './detectors'
import type { DetectionContext, DetectionResult } from './types'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export type {
	DetectionContext,
	DetectionResult,
	FrameworkResult,
	Confidence,
	Tier,
	FrameworkId
} from './types'

/**
 * Detect the framework used in a project directory.
 * Runs detectors in order of specificity and returns the first match.
 * Falls back to a generic Node/Bun project if no specific framework is detected.
 */
export async function detectFramework(ctx: DetectionContext): Promise<DetectionResult> {
	for (const detector of detectors) {
		const result = await detector.detect(ctx)
		if (result) {
			const isMatch = typeof result === 'object'
			return {
				detected: true,
				framework: {
					id: detector.id,
					name: detector.name,
					tier: detector.tier,
					confidence: isMatch ? result.confidence : result,
					meta: isMatch ? result.meta : undefined
				}
			}
		}
	}

	/* Generic fallback for JavaScript projects with a package manifest. */
	if (await ctx.fileExists('package.json')) {
		return {
			detected: true,
			framework: {
				id: 'generic',
				name: 'Generic (Node)',
				tier: 'node',
				confidence: 'low'
			}
		}
	}

	return { detected: false, framework: null }
}

/**
 * Create a DetectionContext from a filesystem directory path.
 * Used when scanning cloned repositories on disk.
 */
export function createFsContext(rootDir: string): DetectionContext {
	return {
		async fileExists(path: string): Promise<boolean> {
			try {
				await access(join(rootDir, path))
				return true
			} catch {
				return false
			}
		},
		async readFile(path: string): Promise<string | null> {
			try {
				return await readFile(join(rootDir, path), 'utf-8')
			} catch {
				return null
			}
		}
	}
}
