import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect } from 'node:net'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaddyClient } from './index'

/** Allocate an ephemeral loopback listener for isolated fixtures. */
async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	return (server.address() as { port: number }).port
}

const binary = process.env.RISVED_TEST_CADDY

describe.skipIf(!binary)('real Caddy path routing', () => {
	let process: ChildProcess
	let directory: string
	let client: CaddyClient
	let proxyPort: number
	let mainPort: number
	let blogPort: number
	const servers: Server[] = []
	let logs = ''

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), 'risved-proxy-'))
		for (const app of ['main', 'blog']) {
			const server = createServer(async (req, res) => {
				if (req.url === '/stream') {
					res.writeHead(200, { 'Content-Type': 'text/event-stream' })
					res.write('data: first\n\n')
					return
				}
				let body = ''
				for await (const chunk of req) body += chunk.toString()
				res.setHeader('Content-Type', 'application/json')
				res.end(
					JSON.stringify({ app, url: req.url, method: req.method, body, headers: req.headers })
				)
			})
			server.on('upgrade', (req, socket) => {
				const accept = createHash('sha1')
					.update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
					.digest('base64')
				socket.end(
					`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Upstream-Path: ${req.url}\r\n\r\n`
				)
			})
			servers.push(server)
			const port = await listen(server)
			if (app === 'main') mainPort = port
			else blogPort = port
		}
		const adminReservation = createServer()
		const proxyReservation = createServer()
		const adminPort = await listen(adminReservation)
		proxyPort = await listen(proxyReservation)
		await Promise.all(
			[adminReservation, proxyReservation].map(s => new Promise<void>(r => s.close(() => r())))
		)
		const adminUrl = `http://127.0.0.1:${adminPort}`
		await writeFile(
			join(directory, 'config.json'),
			JSON.stringify({
				admin: {
					listen: `127.0.0.1:${adminPort}`,
					origins: ['http://localhost:2019', `127.0.0.1:${adminPort}`]
				},
				apps: {
					http: {
						servers: {
							srv0: {
								listen: [`127.0.0.1:${proxyPort}`],
								automatic_https: { disable: true },
								routes: []
							}
						}
					}
				}
			})
		)
		process = spawn(binary!, ['run', '--config', join(directory, 'config.json')], {
			env: { ...globalThis.process.env, XDG_DATA_HOME: directory, XDG_CONFIG_HOME: directory }
		})
		process.stderr?.on('data', data => {
			logs += data.toString()
		})
		client = new CaddyClient({ adminUrl })
		for (let attempt = 0; attempt < 100; attempt++) {
			if ((await client.health()).healthy) return
			await new Promise(r => setTimeout(r, 50))
		}
		throw new Error(`Caddy did not start: ${logs}`)
	}, 15000)

	afterAll(async () => {
		process?.kill()
		if (process && process.exitCode === null) await new Promise(r => process.once('exit', r))
		for (const server of servers) {
			server.closeAllConnections()
			await new Promise<void>(r => server.close(() => r()))
		}
		if (directory) await rm(directory, { recursive: true, force: true })
	})

	/** Send public requests to the isolated listener with deliberately forged forwarding headers. */
	async function request(path: string, init: RequestInit = {}) {
		return new Promise<Response>((resolve, reject) => {
			const req = httpRequest(
				{
					hostname: '127.0.0.1',
					port: proxyPort,
					path,
					method: init.method ?? 'GET',
					headers: {
						Host: 'onui.test',
						'X-Forwarded-Prefix': '/forged',
						'X-Forwarded-Host': 'evil.test',
						'X-Forwarded-Proto': 'https',
						...Object.fromEntries(new Headers(init.headers))
					}
				},
				res =>
					resolve(
						new Response(Readable.toWeb(res) as ReadableStream, {
							status: res.statusCode,
							headers: res.headers as Record<string, string>
						})
					)
			)
			req.once('error', reject)
			req.end(init.body)
		})
	}

	it('forwards both modes, queries, POST bodies, assets, boundaries and longest-prefix matches', async () => {
		expect(await client.addRoute({ hostname: 'onui.test', port: mainPort })).toEqual({
			success: true
		})
		for (const forwardingMode of ['preserve', 'strip'] as const) {
			expect(
				await client.addRoute({
					hostname: 'onui.test',
					port: blogPort,
					pathPrefix: '/blog',
					forwardingMode
				})
			).toEqual({ success: true })
			for (const path of [
				'/blog',
				'/blog/',
				'/blog?preview=1',
				'/blog/story?preview=1&tag=a%2Fb',
				'/blog/assets/site.css'
			]) {
				const response = await (await request(path)).json()
				expect(response).toMatchObject({
					app: 'blog',
					url:
						forwardingMode === 'strip'
							? path.slice(5).startsWith('/')
								? path.slice(5)
								: `/${path.slice(5)}`
							: path
				})
				expect(response.headers).toMatchObject({
					host: 'onui.test',
					'x-forwarded-prefix': '/blog',
					'x-forwarded-host': 'onui.test',
					'x-forwarded-proto': 'http'
				})
			}
			const posted = await (
				await request('/blog/story?draft=1', {
					method: 'POST',
					body: 'hello=world',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
				})
			).json()
			expect(posted).toMatchObject({
				app: 'blog',
				method: 'POST',
				body: 'hello=world',
				url: `${forwardingMode === 'strip' ? '' : '/blog'}/story?draft=1`
			})
		}
		for (const path of ['/', '/blogger'])
			expect(await (await request(path)).json()).toMatchObject({ app: 'main', url: path })
		await client.addRoute({ hostname: 'onui.test', port: mainPort, pathPrefix: '/blog/special' })
		expect(await (await request('/blog/special/story')).json()).toMatchObject({ app: 'main' })
		await client.removeRoute('onui.test', '/blog/special')
		expect(await (await request('/blog/special/story')).json()).toMatchObject({ app: 'blog' })
	})

	it('streams responses and passes WebSocket upgrades with the stripped path', async () => {
		const response = await request('/blog/stream')
		const reader = response.body!.getReader()
		expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n')
		await reader.cancel()
		const upgrade = await new Promise<string>((resolve, reject) => {
			const socket = connect(proxyPort, '127.0.0.1', () =>
				socket.write(
					'GET /blog/socket?token=1 HTTP/1.1\r\nHost: onui.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
				)
			)
			socket.setTimeout(3000, () => {
				socket.destroy()
				reject(new Error('Upgrade timed out'))
			})
			socket.once('error', reject)
			socket.once('data', data => {
				socket.destroy()
				resolve(data.toString())
			})
		})
		expect(upgrade).toContain('101 Switching Protocols')
		expect(upgrade.toLowerCase()).toContain('x-upstream-path: /socket?token=1')
	})

	it('removes a blog mapping while the homepage remains available', async () => {
		expect(await client.removeRoute('onui.test', '/blog')).toEqual({ success: true })
		expect(await (await request('/')).json()).toMatchObject({ app: 'main' })
		expect(await (await request('/blog/story')).json()).toMatchObject({ app: 'main' })
	})
})
