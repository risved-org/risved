import './test-fixtures'
import { describe, expect, it } from 'vitest'
import { getDeploymentDetail } from './logs'
import { mocks, project, queueSelects, selectQueue } from './test-fixtures'
import { isTerminalStatus } from './types'

describe('isTerminalStatus', () => {
	it.each([
		['live', true],
		['failed', true],
		['stopped', true],
		['superseded', true],
		['running', false],
		['pending', false]
	])('%s → %s', (status, expected) => {
		expect(isTerminalStatus(status)).toBe(expected)
	})
})

describe('getDeploymentDetail', () => {
	const deployment = {
		id: 'd-1',
		projectId: 'p-1',
		status: 'failed',
		commitSha: 'abc1234',
		startedAt: '2026-01-01T10:00:00.000Z',
		finishedAt: '2026-01-01T10:02:00.000Z'
	}

	it('returns the log tail in reading order with terminal set', async () => {
		queueSelects(
			[deployment],
			[project],
			[
				{ id: 2, phase: 'build', message: 'second' },
				{ id: 1, phase: 'clone', message: 'first' }
			]
		)

		const detail = await getDeploymentDetail('d-1')

		expect(detail.terminal).toBe(true)
		expect(detail.logTail).toBe('[clone] first\n[build] second')
		expect(detail.url).toBe('https://my-app.example.com')
	})

	it('reports not_found for an unknown deployment', async () => {
		queueSelects([])

		await expect(getDeploymentDetail('nope')).rejects.toMatchObject({ code: 'not_found' })
	})

	/** Record every `.limit(n)` the service issues; the last one is the log tail. */
	function trackLimits(): number[] {
		const seen: number[] = []
		mocks.db.select.mockImplementation(() => {
			const rows = selectQueue.shift() ?? []
			const chain: Record<string, unknown> = {}
			for (const method of ['from', 'where', 'orderBy']) chain[method] = () => chain
			chain.limit = (n: number) => {
				seen.push(n)
				return Promise.resolve(rows)
			}
			chain.then = (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r)
			return chain
		})
		return seen
	}

	it('clamps logLines to the documented maximum', async () => {
		const limits = trackLimits()
		queueSelects([deployment], [project], [])

		await getDeploymentDetail('d-1', 9000)

		expect(limits.at(-1)).toBe(400)
	})

	it('defaults to 80 log lines and floors a nonsense value at 1', async () => {
		const defaults = trackLimits()
		queueSelects([deployment], [project], [])
		await getDeploymentDetail('d-1')
		expect(defaults.at(-1)).toBe(80)

		const floored = trackLimits()
		queueSelects([deployment], [project], [])
		await getDeploymentDetail('d-1', -5)
		expect(floored.at(-1)).toBe(1)
	})
})
