import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDate, tickInterval } from './format-date'

const NOW = new Date('2026-01-15T12:00:00Z').getTime()

afterEach(() => vi.useRealTimers())

function freeze(ms: number) {
	vi.useFakeTimers()
	vi.setSystemTime(ms)
}

describe('formatDate', () => {
	it('returns – for null', () => expect(formatDate(null)).toBe('–'))
	it('returns – for undefined', () => expect(formatDate(undefined)).toBe('–'))
	it('returns – for empty string', () => expect(formatDate('')).toBe('–'))
	it('returns – for invalid date string', () => expect(formatDate('not-a-date')).toBe('–'))

	it('returns Just now for < 60 seconds ago', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 30_000))).toBe('Just now')
	})

	it('returns 1 minute ago at exactly 60 seconds', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 60_000))).toBe('1 minute ago')
	})

	it('returns N minutes ago', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 5 * 60_000))).toBe('5 minutes ago')
	})

	it('returns 1 hour ago at exactly 60 minutes', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 60 * 60_000))).toBe('1 hour ago')
	})

	it('returns N hours ago', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 3 * 3600_000))).toBe('3 hours ago')
	})

	it('returns 1 day ago at exactly 24 hours', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 24 * 3600_000))).toBe('1 day ago')
	})

	it('returns 3 days ago (boundary inside relative range)', () => {
		freeze(NOW)
		expect(formatDate(new Date(NOW - 3 * 24 * 3600_000))).toBe('3 days ago')
	})

	it('returns ISO date for > 3 days', () => {
		freeze(NOW)
		const old = new Date(NOW - 4 * 24 * 3600_000)
		const result = formatDate(old)
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	it('includes time when includeTime is true', () => {
		freeze(NOW)
		const old = new Date(NOW - 10 * 24 * 3600_000)
		const result = formatDate(old, { includeTime: true })
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
	})

	it('omits time when includeTime is false (default)', () => {
		freeze(NOW)
		const old = new Date(NOW - 10 * 24 * 3600_000)
		const result = formatDate(old)
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	it('accepts a numeric timestamp', () => {
		freeze(NOW)
		expect(formatDate(NOW - 30_000)).toBe('Just now')
	})
})

describe('tickInterval', () => {
	it('returns 0 for null', () => {
		freeze(NOW)
		expect(tickInterval(null)).toBe(0)
	})

	it('returns 0 for invalid date', () => {
		freeze(NOW)
		expect(tickInterval('bad')).toBe(0)
	})

	it('returns 60_000 for < 60 seconds', () => {
		freeze(NOW)
		expect(tickInterval(new Date(NOW - 30_000))).toBe(60_000)
	})

	it('returns 60_000 for minutes range', () => {
		freeze(NOW)
		expect(tickInterval(new Date(NOW - 5 * 60_000))).toBe(60_000)
	})

	it('returns 60_000 for hours range', () => {
		freeze(NOW)
		expect(tickInterval(new Date(NOW - 2 * 3600_000))).toBe(60_000)
	})

	it('returns 3_600_000 for days range (1–3 days)', () => {
		freeze(NOW)
		expect(tickInterval(new Date(NOW - 2 * 86400_000))).toBe(3_600_000)
	})

	it('returns 0 for > 3 days', () => {
		freeze(NOW)
		expect(tickInterval(new Date(NOW - 5 * 86400_000))).toBe(0)
	})
})
