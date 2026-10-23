import { expect, it } from 'vitest'
import { withProjectLock } from './project-lock'

it('keeps a rollback queued until the build for its project finishes', async () => {
	let release!: () => void
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	const events: string[] = []
	const build = withProjectLock('project', async () => {
		events.push('build')
		await held
		events.push('built')
	})
	const rollback = withProjectLock('project', async () => {
		events.push('rollback')
	})
	await Promise.resolve()
	await Promise.resolve()
	expect(events).toEqual(['build'])
	release()
	await Promise.all([build, rollback])
	expect(events).toEqual(['build', 'built', 'rollback'])
})

it('releases the project after a failed operation', async () => {
	const failure = withProjectLock('failed-project', async () => {
		throw new Error('build failed')
	})
	const retry = withProjectLock('failed-project', async () => 'recovered')
	await expect(failure).rejects.toThrow('build failed')
	await expect(retry).resolves.toBe('recovered')
})
