/**
 * POST /mcp — the Model Context Protocol endpoint.
 *
 * Streamable HTTP, stateless: no session id generator, so every request is
 * self-contained and authenticated on its own. Two credentials are accepted —
 * an OAuth 2.1 token minted by BetterAuth's mcp plugin (what
 * `claude mcp add --transport http` negotiates in the browser) and an
 * `rsv_…` API key for CI and headless agents.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { withMcpAuth } from 'better-auth/plugins';
import { auth } from '$lib/server/auth';
import { verifyApiKey } from '$lib/server/api-keys';
import { createMcpServer } from '$lib/server/mcp/server';
import type { McpToolContext } from '$lib/server/mcp/schemas';
import type { RequestHandler } from './$types';

const API_KEY_PREFIX = 'rsv_';

let cachedVersion: string | null = null;

/** Advertised to clients on initialize. Best-effort; never fails the request. */
async function serverVersion(): Promise<string> {
	if (cachedVersion) return cachedVersion;

	let version = '0.0.0';
	try {
		const { readFile } = await import('node:fs/promises');
		const { resolve } = await import('node:path');
		const pkg = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
		if (typeof pkg.version === 'string') version = pkg.version;
	} catch {
		/* Unreadable package.json is not worth failing a tool call over. */
	}

	cachedVersion = version;
	return version;
}

function bearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header?.startsWith('Bearer ')) return null;
	return header.slice('Bearer '.length).trim() || null;
}

/** JSON-RPC shaped 401, so a client parses the failure rather than choking. */
function unauthorized(message: string): Response {
	return Response.json(
		{ jsonrpc: '2.0', error: { code: -32000, message }, id: null },
		{ status: 401 }
	);
}

/** JSON-RPC shaped 405 for the methods a stateless server does not offer. */
function methodNotAllowed(): Response {
	return Response.json(
		{
			jsonrpc: '2.0',
			error: {
				code: -32000,
				message: 'Method Not Allowed: this MCP server is stateless — use POST'
			},
			id: null
		},
		{ status: 405, headers: { Allow: 'POST' } }
	);
}

/** Run one JSON-RPC exchange on a throwaway server + transport pair. */
async function serve(request: Request, ctx: McpToolContext): Promise<Response> {
	const server = createMcpServer(ctx, await serverVersion());
	const transport = new WebStandardStreamableHTTPServerTransport({
		/* Stateless: no session id, so no state to carry or reap. */
		sessionIdGenerator: undefined,
		/* Complete JSON responses rather than an SSE stream per call. */
		enableJsonResponse: true
	});

	try {
		await server.connect(transport);
		return await transport.handleRequest(request);
	} finally {
		await transport.close().catch(() => {});
		await server.close().catch(() => {});
	}
}

export const POST: RequestHandler = async (event) => {
	const origin = event.url.origin;
	const token = bearerToken(event.request);

	/* API key: checked first so a key never falls through to the OAuth path. */
	if (token?.startsWith(API_KEY_PREFIX)) {
		const key = await verifyApiKey(token);
		if (!key) return unauthorized('Unauthorized: invalid or revoked API key');
		return serve(event.request, { userId: key.userId, origin });
	}

	/*
	 * OAuth: withMcpAuth answers 401 with the WWW-Authenticate header pointing
	 * at the resource metadata, which is what makes an MCP client open the
	 * browser login flow instead of just failing.
	 */
	return withMcpAuth(auth, async (request, session) => {
		if (!session.userId) return unauthorized('Unauthorized: token has no subject');
		return serve(request, { userId: session.userId, origin });
	})(event.request);
};

export const GET: RequestHandler = async () => methodNotAllowed();
export const DELETE: RequestHandler = async () => methodNotAllowed();
