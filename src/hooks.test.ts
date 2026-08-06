import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/paraglide/runtime', () => ({
	deLocalizeUrl: vi.fn((url: URL) => new URL(url.pathname.replace(/^\/[a-z]{2}(?=\/|$)/, ''), url))
}))

import { reroute } from './hooks'

describe('reroute', () => {
	it('returns the pathname of the delocalized URL', () => {
		const result = reroute({ url: new URL('https://risved.example.eu/en/projects') })

		expect(result).toBe('/projects')
	})

	it('leaves an unlocalized pathname unchanged', () => {
		const result = reroute({ url: new URL('https://risved.example.eu/projects') })

		expect(result).toBe('/projects')
	})
})
