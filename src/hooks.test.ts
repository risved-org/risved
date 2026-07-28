import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/paraglide/runtime', () => ({
	deLocalizeUrl: vi.fn((url: URL) => new URL(url.pathname.replace(/^\/de/, ''), url.origin))
}))

import { reroute } from './hooks'

describe('reroute', () => {
	it('delegates to deLocalizeUrl and returns the pathname', () => {
		const url = new URL('https://example.com/de/about')

		expect(reroute({ url })).toBe('/about')
	})

	it('returns the original pathname when there is no locale prefix', () => {
		const url = new URL('https://example.com/about')

		expect(reroute({ url })).toBe('/about')
	})
})
