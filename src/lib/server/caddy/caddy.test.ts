import { describe, it, expect, vi } from 'vitest';
import { CaddyClient, buildRouteConfig, routeId } from './index';
import type { FetchFn } from './types';

/** Create a mock fetch function with configurable responses */
function createMockFetch(responses: Map<string, { status: number; body?: unknown }>): FetchFn {
	return vi.fn(async (input: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const key = `${method} ${input}`;

		for (const [pattern, response] of responses) {
			if (key.includes(pattern) || input.includes(pattern)) {
				return new Response(JSON.stringify(response.body ?? null), {
					status: response.status,
					statusText: response.status === 200 ? 'OK' : 'Error',
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}

		return new Response('Not Found', { status: 404, statusText: 'Not Found' });
	}) as FetchFn;
}

describe('Caddy Route Management', () => {
	describe('routeId', () => {
		it('generates a safe route ID from a hostname', () => {
			expect(routeId('myapp.risved.example.eu')).toBe('route-myapp-risved-example-eu');
		});

		it('handles wildcard hostnames', () => {
			expect(routeId('*.risved.example.eu')).toBe('route---risved-example-eu');
		});

		it('handles simple hostnames', () => {
			expect(routeId('localhost')).toBe('route-localhost');
		});
	});

	describe('buildRouteConfig', () => {
		it('builds correct Caddy route config', () => {
			const config = buildRouteConfig({ hostname: 'myapp.risved.example.eu', port: 3001 });

			expect(config).toEqual({
				'@id': 'route-myapp-risved-example-eu',
				match: [{ host: ['myapp.risved.example.eu'] }],
				handle: [
					{
						handler: 'encode',
						encodings: { gzip: {}, zstd: {} },
						prefer: ['zstd', 'gzip']
					},
					{
						handler: 'reverse_proxy',
						upstreams: [{ dial: 'localhost:3001' }]
					}
				]
			});
		});

		it('builds config for wildcard hostname', () => {
			const config = buildRouteConfig({ hostname: '*.risved.example.eu', port: 3001 });

			expect(config.match[0].host).toEqual(['*.risved.example.eu']);
			expect(config['@id']).toBe('route---risved-example-eu');
		});
	});

	describe('CaddyClient', () => {
		let mockFetch: FetchFn;
		let client: CaddyClient;

		describe('health()', () => {
			it('returns healthy when Caddy responds with 200', async () => {
				mockFetch = createMockFetch(new Map([['config/', { status: 200, body: {} }]]));
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.health();
				expect(result.healthy).toBe(true);
				expect(result.error).toBeUndefined();
			});

			it('returns unhealthy when Caddy responds with error', async () => {
				mockFetch = createMockFetch(new Map([['config/', { status: 500 }]]));
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.health();
				expect(result.healthy).toBe(false);
				expect(result.error).toContain('500');
			});

			it('returns unhealthy when Caddy is unreachable', async () => {
				mockFetch = vi.fn(async () => {
					throw new Error('Connection refused');
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.health();
				expect(result.healthy).toBe(false);
				expect(result.error).toBe('Connection refused');
			});
		});

		describe('ensureServer()', () => {
			it('succeeds when server already exists', async () => {
				mockFetch = createMockFetch(
					new Map([['srv0', { status: 200, body: { listen: [':443'], routes: [] } }]])
				);
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.ensureServer();
				expect(result.success).toBe(true);
			});

			it('creates server when it does not exist', async () => {
				let callCount = 0;
				mockFetch = vi.fn(async (input: string, init?: RequestInit) => {
					const method = init?.method ?? 'GET';
					if (String(input).includes('srv0') && method === 'GET') {
						return new Response('Not Found', { status: 404 });
					}
					if (String(input).endsWith('/config/') && method === 'PATCH') {
						callCount++;
						return new Response('OK', { status: 200 });
					}
					return new Response('Not Found', { status: 404 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.ensureServer();
				expect(result.success).toBe(true);
				expect(callCount).toBe(1);
			});

			it('returns error when server creation fails', async () => {
				mockFetch = vi.fn(async (_input: string, init?: RequestInit) => {
					const method = init?.method ?? 'GET';
					if (method === 'GET') {
						return new Response('Not Found', { status: 404 });
					}
					return new Response('Internal error', { status: 500 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.ensureServer();
				expect(result.success).toBe(false);
				expect(result.error).toContain('Failed to create server');
			});
		});

		describe('addRoute()', () => {
			it('adds a route successfully', async () => {
				const calls: string[] = [];
				mockFetch = vi.fn(async (input: string, init?: RequestInit) => {
					const method = init?.method ?? 'GET';
					calls.push(`${method} ${input}`);
					if (method === 'DELETE') {
						return new Response('', { status: 404 });
					}
					if (method === 'POST') {
						return new Response('OK', { status: 200 });
					}
					return new Response('Not Found', { status: 404 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.addRoute({
					hostname: 'myapp.risved.example.eu',
					port: 3001
				});

				expect(result.success).toBe(true);
				expect(calls).toContain('DELETE http://localhost:2019/id/route-myapp-risved-example-eu');
				expect(calls).toContain('POST http://localhost:2019/config/apps/http/servers/srv0/routes');
			});

			it('removes existing route before adding', async () => {
				const calls: string[] = [];
				mockFetch = vi.fn(async (input: string, init?: RequestInit) => {
					const method = init?.method ?? 'GET';
					calls.push(`${method} ${input}`);
					return new Response('OK', { status: 200 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				await client.addRoute({ hostname: 'app.example.eu', port: 3002 });

				const deleteIdx = calls.findIndex((c) => c.startsWith('DELETE'));
				const postIdx = calls.findIndex((c) => c.startsWith('POST'));
				expect(deleteIdx).toBeLessThan(postIdx);
			});

			it('returns error when POST fails', async () => {
				mockFetch = vi.fn(async (_input: string, init?: RequestInit) => {
					const method = init?.method ?? 'GET';
					if (method === 'DELETE') return new Response('', { status: 404 });
					return new Response('Bad config', { status: 400 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.addRoute({ hostname: 'app.example.eu', port: 3001 });
				expect(result.success).toBe(false);
				expect(result.error).toContain('Failed to add route');
			});

			it('handles fetch errors gracefully', async () => {
				mockFetch = vi.fn(async () => {
					throw new Error('Network error');
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.addRoute({ hostname: 'app.example.eu', port: 3001 });
				expect(result.success).toBe(false);
				expect(result.error).toBe('Network error');
			});
		});

		describe('removeRoute()', () => {
			it('removes a route by hostname', async () => {
				mockFetch = vi.fn(async () => {
					return new Response('OK', { status: 200 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.removeRoute('myapp.risved.example.eu');
				expect(result.success).toBe(true);
				expect(mockFetch).toHaveBeenCalledWith(
					'http://localhost:2019/id/route-myapp-risved-example-eu',
					expect.objectContaining({ method: 'DELETE' })
				);
			});

			it('succeeds when route does not exist (404)', async () => {
				mockFetch = vi.fn(async () => {
					return new Response('Not Found', { status: 404 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.removeRoute('nonexistent.example.eu');
				expect(result.success).toBe(true);
			});

			it('returns error on server failure', async () => {
				mockFetch = vi.fn(async () => {
					return new Response('Internal error', { status: 500 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.removeRoute('app.example.eu');
				expect(result.success).toBe(false);
				expect(result.error).toContain('Failed to remove route');
			});
		});

		describe('addWildcardRoute()', () => {
			it('adds a wildcard route for a domain', async () => {
				mockFetch = vi.fn(async () => {
					return new Response('OK', { status: 200 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.addWildcardRoute('risved.example.eu', 3001);
				expect(result.success).toBe(true);
			});
		});

		describe('removeWildcardRoute()', () => {
			it('removes a wildcard route for a domain', async () => {
				mockFetch = vi.fn(async () => {
					return new Response('OK', { status: 200 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.removeWildcardRoute('risved.example.eu');
				expect(result.success).toBe(true);
			});
		});

		describe('listRoutes()', () => {
			it('returns routes when server has them', async () => {
				const routes = [
					buildRouteConfig({ hostname: 'app1.example.eu', port: 3001 }),
					buildRouteConfig({ hostname: 'app2.example.eu', port: 3002 })
				];
				mockFetch = createMockFetch(new Map([['routes', { status: 200, body: routes }]]));
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.listRoutes();
				expect(result).toHaveLength(2);
				expect(result[0].match[0].host).toEqual(['app1.example.eu']);
				expect(result[1].match[0].host).toEqual(['app2.example.eu']);
			});

			it('returns empty array when no routes exist', async () => {
				mockFetch = createMockFetch(new Map([['routes', { status: 200, body: [] }]]));
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.listRoutes();
				expect(result).toEqual([]);
			});

			it('returns empty array on error', async () => {
				mockFetch = vi.fn(async () => {
					throw new Error('Network error');
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.listRoutes();
				expect(result).toEqual([]);
			});
		});

		describe('updateRoute()', () => {
			it('updates a route by removing and re-adding', async () => {
				const calls: string[] = [];
				mockFetch = vi.fn(async (input: string, init?: RequestInit) => {
					const method = init?.method ?? 'GET';
					calls.push(`${method} ${input}`);
					if (method === 'DELETE') return new Response('', { status: 200 });
					if (method === 'POST') return new Response('OK', { status: 200 });
					return new Response('Not Found', { status: 404 });
				}) as unknown as FetchFn;
				client = new CaddyClient(undefined, mockFetch);

				const result = await client.updateRoute('app.example.eu', 3005);
				expect(result.success).toBe(true);
			});
		});

		describe('custom admin URL', () => {
			it('uses custom admin URL when provided', async () => {
				mockFetch = vi.fn(async () => {
					return new Response(JSON.stringify({}), { status: 200 });
				}) as unknown as FetchFn;
				client = new CaddyClient({ adminUrl: 'http://caddy:2019' }, mockFetch);

				await client.health();
				expect(mockFetch).toHaveBeenCalledWith('http://caddy:2019/config/', expect.any(Object));
			});
		});
	});
});
