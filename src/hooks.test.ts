import { describe, it, expect, vi } from 'vitest'

const deLocalizeUrl = vi.fn((url: URL) => url)

vi.mock('$lib/paraglide/runtime', () => ({ deLocalizeUrl }))

const { reroute } = await import('./hooks')

describe('reroute', () => {
	it('returns the pathname of the de-localized URL', () => {
		deLocalizeUrl.mockReturnValue(new URL('https://example.com/about'))

		const result = reroute({ url: new URL('https://example.com/de/about') })

		expect(result).toBe('/about')
		expect(deLocalizeUrl).toHaveBeenCalledWith(new URL('https://example.com/de/about'))
	})
})
