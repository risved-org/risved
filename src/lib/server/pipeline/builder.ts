import type { CommandRunner } from './types'

/**
 * Path to the bundled builder Dockerfiles inside the control-plane container.
 * Override with RISVED_BUILDERS_DIR for development/testing.
 */
function buildersDir(): string {
	return process.env.RISVED_BUILDERS_DIR ?? '/app/scripts/builders'
}

/**
 * Verify the warm Node builder image is present in the host's image store, and
 * build it on demand if it is not. The host install script populates this image
 * out-of-band, but it can be missing on first deploy after a fresh install
 * (background job didn't finish, network blip skipped script download) or
 * after Docker prunes unused images. Building here makes the pipeline
 * self-healing instead of failing with an opaque "pull access denied" from
 * Docker Hub.
 */
export async function ensureWarmImage(
	runner: CommandRunner,
	options: { onLine?: (line: string) => void; nodeVersion?: 22 | 24 } = {}
): Promise<{ success: boolean; built: boolean; error?: string }> {
	const nodeVersion = options.nodeVersion ?? 22
	const NODE_BUILD_IMAGE = `risved-node-build:${nodeVersion}`
	const inspect = await runner.exec('docker', [
		'image',
		'inspect',
		'--format',
		nodeVersion === 24 ? '{{.Created}}' : '{{.Id}}',
		NODE_BUILD_IMAGE
	])
	/* Upgraded hosts retain their old cron script, so refresh Node 24 here too. */
	const createdAt = Date.parse(inspect.stdout.trim())
	const fresh = Number.isFinite(createdAt) && Date.now() - createdAt < 7 * 24 * 60 * 60 * 1000
	if (inspect.exitCode === 0 && (nodeVersion !== 24 || fresh)) {
		return { success: true, built: false }
	}

	const dir = buildersDir()
	options.onLine?.(
		`Warm builder image ${NODE_BUILD_IMAGE} is missing or outdated, building it now…`
	)
	const result = await runner.exec(
		'docker',
		[
			'build',
			'--progress=plain',
			...(nodeVersion === 24 ? ['--pull', '--no-cache'] : []),
			'--build-arg',
			`NODE_VERSION=${nodeVersion}`,
			'-t',
			NODE_BUILD_IMAGE,
			'-f',
			`${dir}/node-build.Dockerfile`,
			dir
		],
		{ onLine: options.onLine }
	)
	if (result.exitCode !== 0) {
		return {
			success: false,
			built: false,
			error: result.stderr || result.stdout || 'docker build failed'
		}
	}
	return { success: true, built: true }
}
