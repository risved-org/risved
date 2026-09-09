import { describe, it, expect } from 'vitest'
import { reroute } from './hooks'

describe('reroute', () => {
	it('returns the pathname for an unlocalized url', () => {
		const url = new URL('https://example.com/projects/my-app')
		expect(reroute({ url })).toBe('/projects/my-app')
	})

	it('strips a locale prefix from the pathname', () => {
		const url = new URL('https://example.com/de/projects/my-app')
		expect(reroute({ url })).toBe('/projects/my-app')
	})

	it('returns the root path unchanged', () => {
		const url = new URL('https://example.com/')
		expect(reroute({ url })).toBe('/')
	})
})
