import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Mocks ────────────────────────────────────────────────────────── */

const { mockInsert, mockInsertValues } = vi.hoisted(() => {
	const mockInsertValues = vi.fn().mockResolvedValue(undefined)
	const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues })
	return { mockInsert, mockInsertValues }
})

vi.mock('$lib/server/db', () => ({
	db: { insert: mockInsert }
}))

vi.mock('$lib/server/db/schema', () => ({
	buildLogs: 'build_logs_table'
}))

import { createLogCollector, persistLogs } from './log'

/* ── Tests ────────────────────────────────────────────────────────── */

describe('createLogCollector', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns emit function and entries array', () => {
		const { emit, entries } = createLogCollector('dep-1')
		expect(typeof emit).toBe('function')
		expect(Array.isArray(entries)).toBe(true)
		expect(entries).toHaveLength(0)
	})

	it('stores emitted entries in memory', () => {
		const { emit, entries } = createLogCollector('dep-1')
		emit('clone', 'Cloning repository')
		emit('build', 'Building image', 'info')

		expect(entries).toHaveLength(2)
		expect(entries[0].phase).toBe('clone')
		expect(entries[0].message).toBe('Cloning repository')
		expect(entries[0].level).toBe('info')
		expect(entries[1].phase).toBe('build')
	})

	it('defaults level to info', () => {
		const { emit, entries } = createLogCollector('dep-1')
		emit('clone', 'msg')
		expect(entries[0].level).toBe('info')
	})

	it('sets timestamp on each entry', () => {
		const { emit, entries } = createLogCollector('dep-1')
		emit('clone', 'msg')
		expect(typeof entries[0].timestamp).toBe('string')
		expect(new Date(entries[0].timestamp).getTime()).toBeGreaterThan(0)
	})

	it('calls the stream emitter with each entry', () => {
		const streamEmitter = vi.fn()
		const { emit } = createLogCollector('dep-1', streamEmitter)
		emit('clone', 'hello')

		expect(streamEmitter).toHaveBeenCalledOnce()
		expect(streamEmitter.mock.calls[0][0]).toMatchObject({
			phase: 'clone',
			message: 'hello',
			level: 'info'
		})
	})

	it('works without a stream emitter', () => {
		const { emit, entries } = createLogCollector('dep-1')
		expect(() => emit('clone', 'msg')).not.toThrow()
		expect(entries).toHaveLength(1)
	})

	it('fires a db insert for each emitted entry', () => {
		const { emit } = createLogCollector('dep-1')
		emit('clone', 'msg1')
		emit('build', 'msg2')

		expect(mockInsert).toHaveBeenCalledTimes(2)
	})

	it('uses error level when specified', () => {
		const { emit, entries } = createLogCollector('dep-1')
		emit('build', 'Something failed', 'error')
		expect(entries[0].level).toBe('error')
	})
})

describe('persistLogs', () => {
	beforeEach(() => vi.clearAllMocks())

	it('inserts all entries in a single batch', async () => {
		const entries = [
			{ timestamp: '2024-01-01T00:00:00Z', phase: 'clone' as const, level: 'info' as const, message: 'msg1' },
			{ timestamp: '2024-01-01T00:00:01Z', phase: 'build' as const, level: 'info' as const, message: 'msg2' }
		]

		await persistLogs('dep-1', entries)

		expect(mockInsert).toHaveBeenCalledOnce()
		expect(mockInsertValues).toHaveBeenCalledOnce()
		const vals = mockInsertValues.mock.calls[0][0]
		expect(vals).toHaveLength(2)
		expect(vals[0]).toMatchObject({ deploymentId: 'dep-1', message: 'msg1' })
		expect(vals[1]).toMatchObject({ deploymentId: 'dep-1', message: 'msg2' })
	})

	it('returns early without db call when entries is empty', async () => {
		await persistLogs('dep-1', [])
		expect(mockInsert).not.toHaveBeenCalled()
	})

	it('passes through all entry fields', async () => {
		const entry = {
			timestamp: '2024-01-01T00:00:00Z',
			phase: 'run' as const,
			level: 'warn' as const,
			message: 'a warning'
		}

		await persistLogs('dep-42', [entry])

		const vals = mockInsertValues.mock.calls[0][0]
		expect(vals[0]).toEqual({
			deploymentId: 'dep-42',
			timestamp: '2024-01-01T00:00:00Z',
			phase: 'run',
			level: 'warn',
			message: 'a warning'
		})
	})
})
