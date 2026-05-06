import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	}
}))

function setupSelect(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockResolvedValue(rows),
				limit: vi.fn().mockResolvedValue(rows)
			})
		})
	})
}

vi.mock('$lib/server/db', () => ({ db: mockDb }))
vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', port: 'port' }
}))
vi.mock('drizzle-orm', () => ({
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
	eq: vi.fn((col: unknown, val: unknown) => ({ col, val }))
}))

import { allocatePort, isPortAllocated } from './port'

describe('allocatePort', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns PORT_MIN (3001) when no ports are in use', async () => {
		setupSelect([])
		expect(await allocatePort()).toBe(3001)
	})

	it('returns the first gap when some ports are used', async () => {
		setupSelect([{ port: 3001 }, { port: 3002 }, { port: 3004 }])
		expect(await allocatePort()).toBe(3003)
	})

	it('returns 3002 when only 3001 is used', async () => {
		setupSelect([{ port: 3001 }])
		expect(await allocatePort()).toBe(3002)
	})

	it('throws when all ports 3001-3999 are allocated', async () => {
		const allPorts = Array.from({ length: 999 }, (_, i) => ({ port: 3001 + i }))
		setupSelect(allPorts)
		await expect(allocatePort()).rejects.toThrow('No available ports')
	})
})

describe('isPortAllocated', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns true when a row is found', async () => {
		setupSelect([{ port: 3001 }])
		expect(await isPortAllocated(3001)).toBe(true)
	})

	it('returns false when no row is found', async () => {
		setupSelect([])
		expect(await isPortAllocated(3002)).toBe(false)
	})
})
