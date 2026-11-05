import { describe, expect, it, vi } from 'vitest'
import { withDeploymentResources, withDockerPrune } from './docker-resource-lock'

/** Manually controlled operation so concurrency tests need no timers. */
function gate() {
	let release!: () => void
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release }
}

describe('Docker resource protection', () => {
	it('allows concurrent builds but waits for every build before pruning', async () => {
		const first = gate()
		const second = gate()
		const started = gate()
		const firstBuild = withDeploymentResources(() => first.promise)
		const secondBuild = withDeploymentResources(() => {
			started.release()
			return second.promise
		})
		await started.promise
		const prune = vi.fn(async () => 'pruned')
		const result = withDockerPrune(prune)
		try {
			expect(prune).not.toHaveBeenCalled()
			first.release()
			await firstBuild
			expect(prune).not.toHaveBeenCalled()
		} finally {
			first.release()
			second.release()
			await Promise.all([firstBuild, secondBuild, result])
		}
		expect(await result).toBe('pruned')
	})

	it('queues later builds behind a waiting prune without starving it', async () => {
		const finished = gate()
		const events: string[] = []
		const firstBuild = withDeploymentResources(async () => {
			events.push('first build')
			await finished.promise
		})
		const prune = withDockerPrune(async () => {
			events.push('prune')
		})
		const nextBuild = withDeploymentResources(async () => {
			events.push('next build')
		})
		finished.release()
		await Promise.all([firstBuild, prune, nextBuild])
		expect(events).toEqual(['first build', 'prune', 'next build'])
	})

	it('blocks new builds and other prunes throughout an active prune', async () => {
		const finished = gate()
		const started = gate()
		const prune = withDockerPrune(() => {
			started.release()
			return finished.promise
		})
		await started.promise
		const buildOperation = vi.fn(async () => {})
		const pruneOperation = vi.fn(async () => {})
		const build = withDeploymentResources(buildOperation)
		const nextPrune = withDockerPrune(pruneOperation)
		try {
			await Promise.resolve()
			expect(buildOperation).not.toHaveBeenCalled()
			expect(pruneOperation).not.toHaveBeenCalled()
		} finally {
			finished.release()
			await Promise.all([prune, build, nextPrune])
		}
		expect(buildOperation).toHaveBeenCalledOnce()
		expect(pruneOperation).toHaveBeenCalledOnce()
	})

	it.each([withDeploymentResources, withDockerPrune])(
		'releases protection when an operation throws',
		async (protect) => {
			const failure = new Error('operation failed')
			await expect(
				protect(() => {
					throw failure
				})
			).rejects.toBe(failure)
			await expect(withDockerPrune(async () => 'pruned')).resolves.toBe('pruned')
			await expect(withDeploymentResources(async () => 'built')).resolves.toBe('built')
		}
	)

	it('keeps protection until asynchronous failure cleanup has completed', async () => {
		const cleanup = gate()
		const started = gate()
		const build = withDeploymentResources(async () => {
			try {
				throw new Error('startup failed')
			} finally {
				started.release()
				await cleanup.promise
			}
		})
		const rejected = expect(build).rejects.toThrow('startup failed')
		await started.promise
		const operation = vi.fn(async () => {})
		const prune = withDockerPrune(operation)
		try {
			await Promise.resolve()
			expect(operation).not.toHaveBeenCalled()
		} finally {
			cleanup.release()
			await Promise.all([rejected, prune])
		}
		expect(operation).toHaveBeenCalledOnce()
	})
})
