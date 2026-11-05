import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withDeploymentResources } from '../docker-resource-lock'

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: exec }))
vi.mock('node:util', () => ({ promisify: (fn: unknown) => fn }))
vi.mock('$lib/server/db', () => ({ db: { select: () => ({ from: async () => [] }) } }))
vi.mock('$lib/server/settings', () => ({ getSetting: vi.fn() }))

import { CleanupManager } from './index'

beforeEach(() => {
	exec.mockReset()
})

describe('manual prune timeout and resource protection', () => {
	it.each(['images', 'containers', 'volumes', 'buildcache', 'all'] as const)(
		'uses a finite process timeout and unignorable kill signal for every %s command',
		async (type) => {
			exec.mockImplementation(async (_cmd, args) => {
				if (args[0] === 'volume' && args[1] === 'ls') return { stdout: 'orphan\n' }
				if (args[0] === 'system' && args[1] === 'df') return { stdout: '{"Volumes":[]}' }
				return { stdout: '' }
			})
			await new CleanupManager().dockerPrune(type)
			expect(exec).toHaveBeenCalled()
			for (const [, , options] of exec.mock.calls) {
				expect(options.timeout).toBeGreaterThan(0)
				expect(options.timeout).toBeLessThanOrEqual(120000)
				expect(options.killSignal).toBe('SIGKILL')
			}
		}
	)

	it('waits for the timed-out child to settle before a queued deployment can start', async () => {
		let started!: () => void
		let closed!: (error: Error) => void
		const commandStarted = new Promise<void>((resolve) => {
			started = resolve
		})
		const command = new Promise<never>((_resolve, reject) => {
			closed = reject
		})
		exec.mockImplementation(() => {
			started()
			return command
		})
		const prune = new CleanupManager().dockerPrune('containers')
		await commandStarted
		const operation = vi.fn(async () => 'deployed')
		const deployment = withDeploymentResources(operation)
		try {
			await Promise.resolve()
			expect(operation).not.toHaveBeenCalled()
		} finally {
			closed(Object.assign(new Error('command timed out'), { killed: true, signal: 'SIGKILL' }))
			await Promise.all([prune, deployment])
		}
		expect(await deployment).toBe('deployed')
		expect(operation).toHaveBeenCalledOnce()
	})
})
