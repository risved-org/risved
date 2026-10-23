import { expect, it } from 'vitest'
import { domainAddress } from './domain-address'

it('retains the mount in public addresses and preserves legacy root addresses', () => {
	expect(domainAddress({ hostname: 'onui.com', pathPrefix: '/blog' })).toBe('onui.com/blog')
	expect(domainAddress({ hostname: 'onui.com', pathPrefix: '/blog/stories' })).toBe(
		'onui.com/blog/stories'
	)
	expect(domainAddress({ hostname: 'onui.com', pathPrefix: '/' })).toBe('onui.com')
	expect(domainAddress({ hostname: 'onui.com' })).toBe('onui.com')
})
