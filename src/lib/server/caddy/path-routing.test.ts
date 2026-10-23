import { describe, it, expect } from 'vitest'
import { CaddyClient, buildRouteConfig, routeId } from './index'
import { parseMapping } from '../domain-mapping'
import type { CaddyRouteConfig, FetchFn } from './types'

/** Simulate Caddy's conditional route-list API without touching a running proxy. */
function fixture() {
	let routes: CaddyRouteConfig[] = []
	let revision = 0
	let conflict = false
	const fetchFn: FetchFn = async (url, init) => {
		if (init?.method === 'DELETE') {
			routes = routes.filter(r => r['@id'] !== url.split('/').at(-1))
			revision++
			return new Response(null, { status: 200 })
		}
		if (init?.method === 'PATCH') {
			if (conflict) {
				conflict = false
				routes.push(buildRouteConfig({ hostname: 'other.test', port: 9000 }))
				revision++
			}
			if (new Headers(init.headers).get('If-Match') !== String(revision)) {
				return new Response(null, { status: 412 })
			}
			routes = JSON.parse(String(init.body))
			revision++
			return new Response(null, { status: 200 })
		}
		return Response.json(routes, { headers: { Etag: String(revision) } })
	}
	return {
		client: new CaddyClient(undefined, fetchFn),
		routes: () => routes,
		conflict: () => {
			conflict = true
		}
	}
}

/** Resolve the literal boundary matchers emitted for Caddy. */
function resolve(routes: CaddyRouteConfig[], path: string) {
	return routes.find(r =>
		r.match.some(
			m =>
				!m.path ||
				m.path.some(p => (p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : path === p))
		)
	)?.['@id']
}

describe('path routing', () => {
	it('defaults legacy mappings and rejects ambiguous prefixes and modes', () => {
		expect(parseMapping()).toEqual({ pathPrefix: '/', forwardingMode: 'preserve' })
		for (const path of ['blog', '/blog/', '/blog?x=1', '/a/../b', '/%62log', '/b*', '//blog']) {
			expect(() => parseMapping(path)).toThrow()
		}
		expect(() => parseMapping('/blog', 'invalid')).toThrow()
	})

	it('shares hosts, matches boundaries, sorts longest prefix first, and falls back to root', async () => {
		const f = fixture()
		for (const pathPrefix of ['/blog', '/', '/blog/stories']) {
			expect(
				(await f.client.addRoute({ hostname: 'onui.com', port: 3001, pathPrefix })).success
			).toBe(true)
		}
		for (const [path, prefix] of [
			['/blog', '/blog'],
			['/blog/story', '/blog'],
			['/blog/stories/one', '/blog/stories'],
			['/blogger', '/'],
			['/', '/']
		]) {
			expect(resolve(f.routes(), path)).toBe(routeId('onui.com', prefix))
		}
	})

	it('updates and removes one mapping without removing siblings, including after a concurrent edit', async () => {
		const f = fixture()
		await f.client.addRoute({ hostname: 'onui.com', port: 3001 })
		f.conflict()
		expect(
			(await f.client.addRoute({ hostname: 'onui.com', port: 3002, pathPrefix: '/blog' })).success
		).toBe(true)
		await f.client.updateRoute('onui.com', 3003, '/blog', 'strip')
		expect(f.routes()).toHaveLength(3)
		expect(f.routes()[0].handle).toContainEqual({ handler: 'rewrite', strip_path_prefix: '/blog' })
		await f.client.removeRoute('onui.com', '/blog')
		expect(f.routes().map(r => r['@id'])).toEqual([routeId('onui.com'), routeId('other.test')])
	})

	it('keeps explicit www mappings when adding or removing automatic redirects', async () => {
		const f = fixture()
		await f.client.addRoute({ hostname: 'www.onui.com', port: 3002, pathPrefix: '/blog' })
		await f.client.addRedirectRoute('www.onui.com', 'onui.com', '/blog')
		await f.client.removeRedirectRoute('www.onui.com', '/blog')
		expect(f.routes()).toHaveLength(1)
		expect(f.routes()[0].handle.at(-1)?.handler).toBe('reverse_proxy')
	})

	it('only rewrites paths in strip mode and overwrites the forwarded prefix', () => {
		for (const forwardingMode of ['preserve', 'strip'] as const) {
			const route = buildRouteConfig({
				hostname: 'onui.com',
				port: 3002,
				pathPrefix: '/blog',
				forwardingMode
			})
			expect(route.match[0].path).toEqual(['/blog', '/blog/*'])
			expect(route.handle.filter(h => h.handler === 'rewrite')).toHaveLength(
				forwardingMode === 'strip' ? 1 : 0
			)
			expect(route.handle.at(-1)).toMatchObject({
				headers: { request: { set: { 'X-Forwarded-Prefix': ['/blog'] } } }
			})
		}
	})
})
