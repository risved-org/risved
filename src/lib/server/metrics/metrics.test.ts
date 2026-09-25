import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }
}))

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table',
	deployments: 'deployments_table',
	resourceMetrics: {
		projectId: 'project_id',
		bucket: 'bucket',
		id: 'id'
	},
	bandwidthDaily: {
		projectId: 'project_id',
		day: 'day',
		rxBytes: 'rx_bytes',
		txBytes: 'tx_bytes',
		updatedAt: 'updated_at'
	}
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
	and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
	desc: vi.fn(() => 'desc_fn'),
	gte: vi.fn(() => 'gte_fn'),
	lt: vi.fn(() => 'lt_fn'),
	sql: vi.fn(() => 'sql_fn')
}))

vi.mock('node:child_process', () => ({
	execSync: vi.fn()
}))

import { db } from '$lib/server/db'
import {
	MetricsCollector,
	parseDockerStats,
	parseStatsOutput,
	parseNetIo,
	parseDockerSize,
	toBucket,
	toDay,
	getBandwidthBytes,
	getProjectMetrics,
	getServerMetrics,
	getMetricsCollector,
	_resetMetricsCollector
} from './index'

const mockDb = db as unknown as {
	select: ReturnType<typeof vi.fn>
	insert: ReturnType<typeof vi.fn>
	update: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function setupCollectMocks(projectRows: unknown[] = [], existingMetrics: unknown[] = []) {
	/* getProjectContainerMap: db.select().from(projects) */
	/* upsertMetric: db.select().from(resourceMetrics).where(...).limit(1) */
	mockDb.select
		.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue(projectRows)
		})
		.mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(existingMetrics)
				})
			})
		})

	mockDb.insert.mockReturnValue({
		values: vi.fn().mockReturnValue({
			onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
		})
	})

	mockDb.update.mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	})

	mockDb.delete.mockReturnValue({
		where: vi.fn().mockResolvedValue(undefined)
	})
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('toBucket', () => {
	it('truncates date to the start of the hour', () => {
		const date = new Date('2026-03-13T14:37:22.123Z')
		expect(toBucket(date)).toBe('2026-03-13T14:00:00.000Z')
	})

	it('handles exact hour boundary', () => {
		const date = new Date('2026-03-13T10:00:00.000Z')
		expect(toBucket(date)).toBe('2026-03-13T10:00:00.000Z')
	})
})

describe('parseStatsOutput', () => {
	it('parses docker stats format correctly', () => {
		const output = 'myapp|12.50%|256MiB / 2GiB\nother|3.20%|128MiB / 1GiB\n'
		const containerMap = new Map([['myapp', 'p-1']])

		const stats = parseStatsOutput(output, containerMap)
		expect(stats).toHaveLength(1)
		expect(stats[0].projectId).toBe('p-1')
		expect(stats[0].cpuPercent).toBe(12.5)
		expect(stats[0].memoryMb).toBe(256)
		expect(stats[0].memoryLimitMb).toBe(2048)
	})

	it('handles GiB memory units', () => {
		const output = 'app|1.00%|1.5GiB / 4GiB\n'
		const containerMap = new Map([['app', 'p-1']])

		const stats = parseStatsOutput(output, containerMap)
		expect(stats[0].memoryMb).toBe(1536)
		expect(stats[0].memoryLimitMb).toBe(4096)
	})

	it('skips unknown containers', () => {
		const output = 'unknown|5.00%|100MiB / 1GiB\n'
		const containerMap = new Map([['myapp', 'p-1']])

		const stats = parseStatsOutput(output, containerMap)
		expect(stats).toHaveLength(0)
	})

	it('handles empty output', () => {
		const stats = parseStatsOutput('', new Map())
		expect(stats).toHaveLength(0)
	})

	it('handles malformed lines', () => {
		const output = 'invalid line\n'
		const stats = parseStatsOutput(output, new Map([['app', 'p-1']]))
		expect(stats).toHaveLength(0)
	})

	it('handles KiB memory units', () => {
		const output = 'app|1.00%|2048KiB / 1GiB\n'
		const stats = parseStatsOutput(output, new Map([['app', 'p-1']]))
		expect(stats[0].memoryMb).toBe(2) // 2048/1024 = 2 MB
	})

	it('parses optional NetIO and container ID columns', () => {
		const output = 'myapp|1.00%|64MiB / 1GiB|98.7MB / 57.7MB|aca3ac3f8647\n'
		const containerMap = new Map([['myapp', 'p-1']])

		const stats = parseStatsOutput(output, containerMap)
		expect(stats).toHaveLength(1)
		expect(stats[0].netRxBytes).toBe(98_700_000)
		expect(stats[0].netTxBytes).toBe(57_700_000)
		expect(stats[0].containerId).toBe('aca3ac3f8647')
	})

	it('leaves network fields undefined for the three-column format', () => {
		const stats = parseStatsOutput('myapp|1.00%|64MiB / 1GiB\n', new Map([['myapp', 'p-1']]))
		expect(stats[0].netRxBytes).toBeUndefined()
		expect(stats[0].containerId).toBeUndefined()
	})

	it('returns 0 for unrecognised memory units (bytes)', () => {
		const output = 'app|1.00%|512B / 1GiB\n'
		const stats = parseStatsOutput(output, new Map([['app', 'p-1']]))
		expect(stats[0].memoryMb).toBe(0)
	})
})

describe('parseNetIo', () => {
	it('parses received and sent bytes with decimal units', () => {
		expect(parseNetIo('1.88kB / 126B')).toEqual([1880, 126])
		expect(parseNetIo('0B / 0B')).toEqual([0, 0])
	})

	it('returns zeros for malformed input', () => {
		expect(parseNetIo('garbage')).toEqual([0, 0])
	})
})

describe('parseDockerSize', () => {
	it('handles decimal and binary units', () => {
		expect(parseDockerSize('453MB')).toBe(453_000_000)
		expect(parseDockerSize('1.5GB')).toBe(1_500_000_000)
		expect(parseDockerSize('65.47MB')).toBe(65_470_000)
		expect(parseDockerSize('1KiB')).toBe(1024)
		expect(parseDockerSize('126B')).toBe(126)
	})

	it('returns 0 for unknown units or garbage', () => {
		expect(parseDockerSize('12 parsecs')).toBe(0)
		expect(parseDockerSize('')).toBe(0)
	})
})

describe('toDay', () => {
	it('formats the UTC calendar day', () => {
		expect(toDay(new Date('2026-03-13T23:59:59.000Z'))).toBe('2026-03-13')
	})
})

describe('MetricsCollector', () => {
	let collector: MetricsCollector

	beforeEach(() => {
		/* Reset (not just clear) so queued mockReturnValueOnce values never leak between tests */
		vi.resetAllMocks()
	})

	afterEach(() => {
		collector?.stop()
	})

	describe('start / stop', () => {
		it('starts and stops without errors', () => {
			collector = new MetricsCollector({ intervalMs: 100000 })
			collector.start()
			collector.start() // no-op
			collector.stop()
			expect(true).toBe(true)
		})
	})

	describe('collect', () => {
		it('collects and stores metrics for live containers', async () => {
			const execFn = vi.fn().mockReturnValue('myapp|5.00%|200MiB / 2GiB\n')

			collector = new MetricsCollector({ execFn })

			setupCollectMocks(
				[{ id: 'p-1', slug: 'myapp', port: 3001 }],
				[] // no existing metrics
			)

			await collector.collect()

			expect(execFn).toHaveBeenCalledTimes(1)
			expect(mockDb.insert).toHaveBeenCalled()
		})

		it('updates existing bucket when metric already exists', async () => {
			const execFn = vi.fn().mockReturnValue('myapp|10.00%|300MiB / 2GiB\n')

			collector = new MetricsCollector({ execFn })

			setupCollectMocks(
				[{ id: 'p-1', slug: 'myapp', port: 3001 }],
				[{ id: 1, cpuPercent: 500, memoryMb: 200, memoryLimitMb: 2048, sampleCount: 1 }]
			)

			await collector.collect()

			expect(mockDb.update).toHaveBeenCalled()
		})

		it('handles empty container map gracefully', async () => {
			const execFn = vi.fn()
			collector = new MetricsCollector({ execFn })

			setupCollectMocks([])

			await collector.collect()
			expect(execFn).not.toHaveBeenCalled()
		})

		it('handles exec failure gracefully', async () => {
			const execFn = vi.fn().mockImplementation(() => {
				throw new Error('docker not found')
			})

			collector = new MetricsCollector({ execFn })

			setupCollectMocks([{ id: 'p-1', slug: 'myapp', port: 3001 }])

			// Should not throw
			await expect(collector.collect()).resolves.toBeUndefined()
		})

		it('excludes projects without a port from the container map', async () => {
			const execFn = vi.fn()
			collector = new MetricsCollector({ execFn })

			setupCollectMocks([{ id: 'p-1', slug: 'myapp', port: null }])

			await collector.collect()
			expect(execFn).not.toHaveBeenCalled()
		})

		it('records bandwidth as the delta between consecutive samples', async () => {
			const execFn = vi
				.fn()
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|1MB / 2MB|abc123\n')
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|1.5MB / 2.25MB|abc123\n')
			collector = new MetricsCollector({ execFn })
			const project = [{ id: 'p-1', slug: 'myapp', port: 3001 }]
			const existing = [
				{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }
			]

			/* First sample only sets the baseline */
			setupCollectMocks(project, existing)
			await collector.collect()
			expect(mockDb.insert).not.toHaveBeenCalled()

			/* Second sample writes the delta into today's bucket */
			setupCollectMocks(project, existing)
			await collector.collect()
			expect(mockDb.insert).toHaveBeenCalledTimes(1)
			const valuesFn = mockDb.insert.mock.results[0].value.values
			expect(valuesFn).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'p-1',
					day: toDay(new Date()),
					rxBytes: 500_000,
					txBytes: 250_000
				})
			)
		})

		it('counts the whole counter when the container was replaced', async () => {
			const execFn = vi
				.fn()
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|9MB / 9MB|old111\n')
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|300kB / 100kB|new222\n')
			collector = new MetricsCollector({ execFn })
			const project = [{ id: 'p-1', slug: 'myapp', port: 3001 }]
			const existing = [
				{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }
			]

			setupCollectMocks(project, existing)
			await collector.collect()
			setupCollectMocks(project, existing)
			await collector.collect()

			const valuesFn = mockDb.insert.mock.results[0].value.values
			expect(valuesFn).toHaveBeenCalledWith(
				expect.objectContaining({ rxBytes: 300_000, txBytes: 100_000 })
			)
		})

		it('counts the whole counter when it went backwards after a restart', async () => {
			const execFn = vi
				.fn()
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|9MB / 9MB|abc123\n')
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|10kB / 5kB|abc123\n')
			collector = new MetricsCollector({ execFn })
			const project = [{ id: 'p-1', slug: 'myapp', port: 3001 }]
			const existing = [
				{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }
			]

			setupCollectMocks(project, existing)
			await collector.collect()
			setupCollectMocks(project, existing)
			await collector.collect()

			const valuesFn = mockDb.insert.mock.results[0].value.values
			expect(valuesFn).toHaveBeenCalledWith(
				expect.objectContaining({ rxBytes: 10_000, txBytes: 5_000 })
			)
		})

		it('skips the write when nothing was transferred', async () => {
			const execFn = vi.fn().mockReturnValue('myapp|1.00%|64MiB / 1GiB|5MB / 5MB|abc123\n')
			collector = new MetricsCollector({ execFn })
			const project = [{ id: 'p-1', slug: 'myapp', port: 3001 }]
			const existing = [
				{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }
			]

			setupCollectMocks(project, existing)
			await collector.collect()
			setupCollectMocks(project, existing)
			await collector.collect()

			expect(mockDb.insert).not.toHaveBeenCalled()
		})

		it('keeps the bandwidth baseline when the write fails, so no traffic is lost', async () => {
			const execFn = vi
				.fn()
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|1MB / 1MB|abc123\n')
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|2MB / 2MB|abc123\n')
				.mockReturnValueOnce('myapp|1.00%|64MiB / 1GiB|3MB / 3MB|abc123\n')
			collector = new MetricsCollector({ execFn })

			const projectRows = [{ id: 'p-1', slug: 'myapp', port: 3001 }]
			const existing = [
				{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }
			]
			mockDb.select.mockImplementation(() => ({
				from: vi.fn((table: unknown) =>
					table === 'projects_table'
						? Promise.resolve(projectRows)
						: { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existing) }) }
				)
			}))
			mockDb.update.mockReturnValue({
				set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
			})
			mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

			const failingWrite = vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockRejectedValue(new Error('database is locked'))
			})
			mockDb.insert.mockReturnValue({ values: failingWrite })

			/* First sample only sets the baseline */
			await collector.collect()
			expect(failingWrite).not.toHaveBeenCalled()

			/* Second sample's 1MB delta is rejected by the database */
			await collector.collect()
			expect(failingWrite).toHaveBeenCalledWith(
				expect.objectContaining({ rxBytes: 1_000_000, txBytes: 1_000_000 })
			)

			const succeedingWrite = vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
			})
			mockDb.insert.mockReturnValue({ values: succeedingWrite })

			/* Third sample measures from the 1MB baseline, not the lost 2MB one */
			await collector.collect()
			expect(succeedingWrite).toHaveBeenCalledWith(
				expect.objectContaining({ rxBytes: 2_000_000, txBytes: 2_000_000 })
			)
		})

		it('records the other projects when one write fails', async () => {
			const execFn = vi
				.fn()
				.mockReturnValueOnce(
					'myapp|1.00%|64MiB / 1GiB|5MB / 5MB|abc123\nother|2.00%|32MiB / 1GiB|7MB / 7MB|def456\n'
				)
				.mockReturnValueOnce(
					'myapp|1.00%|64MiB / 1GiB|6MB / 6MB|abc123\nother|2.00%|32MiB / 1GiB|9MB / 9MB|def456\n'
				)
			collector = new MetricsCollector({ execFn })

			const projectRows = [
				{ id: 'p-1', slug: 'myapp', port: 3001 },
				{ id: 'p-2', slug: 'other', port: 3002 }
			]
			const existing = [
				{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }
			]
			mockDb.select.mockImplementation(() => ({
				from: vi.fn((table: unknown) =>
					table === 'projects_table'
						? Promise.resolve(projectRows)
						: { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existing) }) }
				)
			}))
			mockDb.update.mockReturnValue({
				set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
			})
			mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

			const written: string[] = []
			const values = vi.fn((row: { projectId: string }) => ({
				onConflictDoUpdate: vi.fn(() => {
					if (row.projectId === 'p-1') return Promise.reject(new Error('database is locked'))
					written.push(row.projectId)
					return Promise.resolve(undefined)
				})
			}))
			mockDb.insert.mockReturnValue({ values })

			await collector.collect()
			await collector.collect()

			/* p-1 comes first in the loop; its failure must not skip p-2 or the prune */
			expect(written).toEqual(['p-2'])
			expect(mockDb.delete).toHaveBeenCalled()
		})

		it('prunes both resource metrics and old bandwidth days', async () => {
			const execFn = vi.fn().mockReturnValue('myapp|1.00%|64MiB / 1GiB\n')
			collector = new MetricsCollector({ execFn })

			setupCollectMocks(
				[{ id: 'p-1', slug: 'myapp', port: 3001 }],
				[{ id: 1, cpuPercent: 100, memoryMb: 64, memoryLimitMb: 1024, sampleCount: 1 }]
			)
			await collector.collect()

			expect(mockDb.delete).toHaveBeenCalledTimes(2)
		})

		it('keeps collecting for a project whose newest deployment failed', async () => {
			/* The container from the last good deploy is still serving traffic,
			   so it must still be sampled — deployment status says nothing
			   about whether a container is running. */
			const execFn = vi.fn().mockReturnValue('myapp|5.00%|200MiB / 2GiB\n')
			collector = new MetricsCollector({ execFn })

			setupCollectMocks([{ id: 'p-1', slug: 'myapp', port: 3001 }], [])

			await collector.collect()

			expect(execFn).toHaveBeenCalledWith(
				'docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.ID}}"'
			)
			expect(mockDb.insert).toHaveBeenCalled()
		})

		it('ignores running containers that belong to no project', async () => {
			const execFn = vi
				.fn()
				.mockReturnValue('risved-caddy|1.00%|30MiB / 2GiB\nrisved-control|2.00%|90MiB / 2GiB\n')
			collector = new MetricsCollector({ execFn })

			setupCollectMocks([{ id: 'p-1', slug: 'myapp', port: 3001 }], [])

			await collector.collect()

			expect(mockDb.insert).not.toHaveBeenCalled()
			expect(mockDb.update).not.toHaveBeenCalled()
		})

		it('skips a run while the previous one is still in flight', async () => {
			/* Two overlapping runs race on the bandwidth baseline: the older one
			   sees the counters go backwards and books a whole lifetime of
			   traffic as new. */
			const execFn = vi.fn().mockReturnValue('myapp|1.00%|64MiB / 1GiB|5MB / 5MB|abc123\n')
			collector = new MetricsCollector({ execFn })

			const projectRows = [{ id: 'p-1', slug: 'myapp', port: 3001 }]
			let releaseProjects: (rows: unknown[]) => void = () => {}
			const gate = new Promise<unknown[]>(resolve => {
				releaseProjects = resolve
			})

			/* Only the first project lookup is gated; a second run that ignored
			   the guard would sail past it and reach `docker stats`. */
			let projectLookups = 0
			mockDb.select.mockImplementation(() => ({
				from: vi.fn((table: unknown) =>
					table === 'projects_table'
						? projectLookups++ === 0
							? gate
							: Promise.resolve(projectRows)
						: { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }
				)
			}))
			mockDb.insert.mockReturnValue({
				values: vi
					.fn()
					.mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })
			})
			mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

			const first = collector.collect()
			const second = collector.collect()

			/* The second run returned without waiting on the gated query */
			await second
			expect(execFn).not.toHaveBeenCalled()

			releaseProjects(projectRows)
			await first

			expect(execFn).toHaveBeenCalledTimes(1)
		})
	})
})

function setupQueryMock(rows: unknown[]) {
	const orderByFn = vi.fn().mockResolvedValue(rows)
	const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn })
	const fromFn = vi.fn().mockReturnValue({ where: whereFn })
	mockDb.select.mockReturnValueOnce({ from: fromFn })
}

describe('getProjectMetrics', () => {
	beforeEach(() => {
		vi.resetAllMocks()
	})

	it('returns formatted metric points', async () => {
		setupQueryMock([
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 500,
				memoryMb: 256,
				memoryLimitMb: 2048,
				sampleCount: 5
			}
		])

		const metrics = await getProjectMetrics('p-1', 24)
		expect(metrics).toHaveLength(1)
		expect(metrics[0].cpuPercent).toBe(5) // 500 / 100
		expect(metrics[0].memoryMb).toBe(256)
		expect(metrics[0].bucket).toBe('2026-03-13T10:00:00.000Z')
	})
})

describe('getServerMetrics', () => {
	beforeEach(() => {
		vi.resetAllMocks()
	})

	it('aggregates metrics across projects by bucket', async () => {
		setupQueryMock([
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 500,
				memoryMb: 256,
				memoryLimitMb: 2048,
				sampleCount: 3
			},
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 300,
				memoryMb: 128,
				memoryLimitMb: 1024,
				sampleCount: 2
			}
		])

		const metrics = await getServerMetrics(24)
		expect(metrics).toHaveLength(1)
		expect(metrics[0].cpuPercent).toBe(8) // (500 + 300) / 100
		expect(metrics[0].memoryMb).toBe(384) // 256 + 128
	})

	it('returns empty array when no metrics', async () => {
		setupQueryMock([])

		const metrics = await getServerMetrics(24)
		expect(metrics).toEqual([])
	})

	it('sorts multiple distinct buckets in ascending order', async () => {
		setupQueryMock([
			{
				bucket: '2026-03-13T12:00:00.000Z',
				cpuPercent: 200,
				memoryMb: 128,
				memoryLimitMb: 1024,
				sampleCount: 1
			},
			{
				bucket: '2026-03-13T10:00:00.000Z',
				cpuPercent: 400,
				memoryMb: 256,
				memoryLimitMb: 2048,
				sampleCount: 2
			}
		])

		const metrics = await getServerMetrics(24)
		expect(metrics).toHaveLength(2)
		expect(metrics[0].bucket).toBe('2026-03-13T10:00:00.000Z')
		expect(metrics[1].bucket).toBe('2026-03-13T12:00:00.000Z')
	})
})

describe('getBandwidthBytes', () => {
	beforeEach(() => {
		vi.resetAllMocks()
	})

	function setupBandwidthMock(rows: unknown[]) {
		const whereFn = vi.fn().mockResolvedValue(rows)
		const fromFn = vi.fn().mockReturnValue({ where: whereFn })
		mockDb.select.mockReturnValueOnce({ from: fromFn })
		return whereFn
	}

	it('sums received and sent bytes across all rows', async () => {
		setupBandwidthMock([
			{ rxBytes: 1_000, txBytes: 2_000 },
			{ rxBytes: 10, txBytes: 20 }
		])

		expect(await getBandwidthBytes(30)).toBe(3_030)
	})

	it('returns 0 when there are no rows', async () => {
		setupBandwidthMock([])
		expect(await getBandwidthBytes()).toBe(0)
	})

	it('queries from the first day of the window', async () => {
		const { gte } = await import('drizzle-orm')
		setupBandwidthMock([])
		const since = new Date()
		since.setUTCDate(since.getUTCDate() - 29)

		await getBandwidthBytes(30)
		expect(gte).toHaveBeenCalledWith('day', toDay(since))
	})
})

describe('getMetricsCollector / _resetMetricsCollector', () => {
	beforeEach(() => {
		vi.resetAllMocks()
		_resetMetricsCollector()
	})

	afterEach(() => {
		_resetMetricsCollector()
	})

	it('returns a MetricsCollector instance', () => {
		const collector = getMetricsCollector()
		expect(collector).toBeInstanceOf(MetricsCollector)
	})

	it('returns the same singleton on subsequent calls', () => {
		const c1 = getMetricsCollector()
		const c2 = getMetricsCollector()
		expect(c1).toBe(c2)
	})

	it('returns a new instance after reset', () => {
		const c1 = getMetricsCollector()
		_resetMetricsCollector()
		const c2 = getMetricsCollector()
		expect(c1).not.toBe(c2)
	})

	it('_resetMetricsCollector is safe when no instance exists', () => {
		_resetMetricsCollector() // already null from beforeEach
		expect(() => _resetMetricsCollector()).not.toThrow()
	})
})

describe('parseDockerStats (four-column format)', () => {
	it('parses valid output with MiB units', () => {
		const output = 'myapp|12.50%|256MiB|1GiB\n'
		const map = new Map([['myapp', 'p-1']])
		const stats = parseDockerStats(output, map)
		expect(stats).toHaveLength(1)
		expect(stats[0]).toMatchObject({
			projectId: 'p-1',
			containerName: 'myapp',
			cpuPercent: 12.5,
			memoryMb: 256,
			memoryLimitMb: 1024
		})
	})

	it('parses GiB memory fields', () => {
		const output = 'app|2.00%|1.5GiB|4GiB\n'
		const map = new Map([['app', 'p-1']])
		const stats = parseDockerStats(output, map)
		expect(stats[0].memoryMb).toBe(1536)
		expect(stats[0].memoryLimitMb).toBe(4096)
	})

	it('skips unknown container names', () => {
		const output = 'unknown|5.00%|100MiB|1GiB\n'
		const map = new Map([['myapp', 'p-1']])
		expect(parseDockerStats(output, map)).toHaveLength(0)
	})

	it('skips lines with fewer than four parts', () => {
		const output = 'myapp|5.00%|100MiB\n'
		const map = new Map([['myapp', 'p-1']])
		expect(parseDockerStats(output, map)).toHaveLength(0)
	})

	it('skips blank lines', () => {
		const output = '\n\nmyapp|1.00%|128MiB|2GiB\n\n'
		const map = new Map([['myapp', 'p-1']])
		expect(parseDockerStats(output, map)).toHaveLength(1)
	})

	it('handles multiple containers', () => {
		const output = 'app1|1.00%|100MiB|1GiB\napp2|2.00%|200MiB|2GiB\n'
		const map = new Map([
			['app1', 'p-1'],
			['app2', 'p-2']
		])
		const stats = parseDockerStats(output, map)
		expect(stats).toHaveLength(2)
		expect(stats[0].projectId).toBe('p-1')
		expect(stats[1].projectId).toBe('p-2')
	})
})

describe('MetricsCollector default execFn', () => {
	it('uses execSync as the default when no execFn is provided', () => {
		const collector = new MetricsCollector()
		expect(collector).toBeInstanceOf(MetricsCollector)
	})
})
