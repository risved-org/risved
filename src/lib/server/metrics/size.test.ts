import { describe, it, expect } from 'vitest'
import { parseDockerSize } from './size'

describe('parseDockerSize', () => {
	it('parses decimal units', () => {
		expect(parseDockerSize('98.7MB')).toBe(98_700_000)
		expect(parseDockerSize('1.88kB')).toBe(1880)
		expect(parseDockerSize('126B')).toBe(126)
	})

	it('parses binary units', () => {
		expect(parseDockerSize('1.5GiB')).toBe(Math.round(1.5 * 1024 ** 3))
	})

	it('treats a bare number as bytes', () => {
		expect(parseDockerSize('126')).toBe(126)
	})

	it('is case-insensitive and trims whitespace', () => {
		expect(parseDockerSize('  2 mb  ')).toBe(2_000_000)
	})

	it('returns 0 for an unparseable value', () => {
		expect(parseDockerSize('n/a')).toBe(0)
	})

	it('returns 0 when the numeric part is not finite', () => {
		expect(parseDockerSize('.')).toBe(0)
	})

	it('returns 0 for an unrecognized unit', () => {
		expect(parseDockerSize('5xyz')).toBe(0)
	})
})
