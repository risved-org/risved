import { describe, it, expect } from 'vitest'
import { reroute } from './hooks'

describe('reroute', () => {
	it('returns the de-localized pathname for a request URL', () => {
		const url = new URL('https://risved.example.eu/projects/my-app')

		expect(reroute({ url })).toBe('/projects/my-app')
	})

	it('returns the root pathname unchanged', () => {
		const url = new URL('https://risved.example.eu/')

		expect(reroute({ url })).toBe('/')
	})
})
