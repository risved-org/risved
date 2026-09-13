import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	verifyApiKey: vi.fn(),
	getMcpSession: vi.fn(),
	listProjects: vi.fn()
}));

vi.mock('$lib/server/api-keys', () => ({ verifyApiKey: mocks.verifyApiKey }));

vi.mock('$lib/server/auth', () => ({
	auth: {
		options: { baseURL: 'https://risved.test/api/auth', basePath: '/api/auth' },
		api: { getMcpSession: mocks.getMcpSession }
	}
}));

vi.mock('$lib/server/projects', async () => {
	class ServiceError extends Error {
		constructor(
			readonly code: string,
			message: string,
			readonly data: Record<string, unknown> = {}
		) {
			super(message);
			this.name = 'ServiceError';
		}
	}
	return {
		ServiceError,
		listProjects: mocks.listProjects,
		getProjectDetail: vi.fn(),
		createProject: vi.fn(),
		setProjectEnv: vi.fn(),
		deployProject: vi.fn(),
		getDeploymentDetail: vi.fn(),
		rollbackProject: vi.fn()
	};
});

import { GET, DELETE, POST } from './+server';

const ACCEPT = 'application/json, text/event-stream';

function makeEvent(init: { body?: unknown; headers?: Record<string, string> } = {}) {
	const headers = new Headers({
		'Content-Type': 'application/json',
		Accept: ACCEPT,
		...(init.headers ?? {})
	});

	return {
		url: new URL('https://risved.test/mcp'),
		request: new Request('https://risved.test/mcp', {
			method: 'POST',
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body)
		})
	} as unknown as Parameters<typeof POST>[0];
}

const initialize = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'curl', version: '0' }
	}
};

beforeEach(() => vi.clearAllMocks());

describe('method handling', () => {
	it('answers GET with 405 — the server is stateless', async () => {
		const res = await GET({} as never);

		expect(res.status).toBe(405);
		expect(res.headers.get('Allow')).toBe('POST');
		await expect(res.json()).resolves.toMatchObject({ jsonrpc: '2.0' });
	});

	it('answers DELETE with 405', async () => {
		const res = await DELETE({} as never);

		expect(res.status).toBe(405);
	});
});

describe('API key auth', () => {
	it('rejects a revoked key with 401 and no data', async () => {
		mocks.verifyApiKey.mockResolvedValue(null);

		const res = await POST(
			makeEvent({ body: initialize, headers: { Authorization: 'Bearer rsv_revoked' } })
		);

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.message).toContain('invalid or revoked');
		expect(mocks.listProjects).not.toHaveBeenCalled();
	});

	it('completes an initialize handshake for a live key', async () => {
		mocks.verifyApiKey.mockResolvedValue({ userId: 'u-1', id: 'k-1' });

		const res = await POST(
			makeEvent({ body: initialize, headers: { Authorization: 'Bearer rsv_live' } })
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.result.serverInfo.name).toBe('risved');
		expect(body.result.capabilities.tools).toBeDefined();
	});

	it('lists tools for a live key', async () => {
		mocks.verifyApiKey.mockResolvedValue({ userId: 'u-1', id: 'k-1' });

		const res = await POST(
			makeEvent({
				body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
				headers: { Authorization: 'Bearer rsv_live' }
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.result.tools.map((t: { name: string }) => t.name)).toContain('list_projects');
	});

	it('runs a tool as the key’s owner', async () => {
		mocks.verifyApiKey.mockResolvedValue({ userId: 'u-1', id: 'k-1' });
		mocks.listProjects.mockResolvedValue([]);

		const res = await POST(
			makeEvent({
				body: {
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'list_projects', arguments: {} }
				},
				headers: { Authorization: 'Bearer rsv_live' }
			})
		);

		const body = await res.json();
		expect(body.result.structuredContent).toEqual({ projects: [] });
		expect(mocks.listProjects).toHaveBeenCalledOnce();
	});
});

describe('OAuth auth', () => {
	it('answers an unauthenticated request with 401 and WWW-Authenticate', async () => {
		mocks.getMcpSession.mockResolvedValue(null);

		const res = await POST(makeEvent({ body: initialize }));

		expect(res.status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toContain('/.well-known/oauth-protected-resource');
		expect(mocks.verifyApiKey).not.toHaveBeenCalled();
	});

	it('serves a request carrying a valid OAuth token', async () => {
		mocks.getMcpSession.mockResolvedValue({ userId: 'u-9' });

		const res = await POST(
			makeEvent({ body: initialize, headers: { Authorization: 'Bearer oauth-token' } })
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ result: { serverInfo: { name: 'risved' } } });
	});

	it('rejects an OAuth token with no subject', async () => {
		mocks.getMcpSession.mockResolvedValue({ userId: null });

		const res = await POST(
			makeEvent({ body: initialize, headers: { Authorization: 'Bearer oauth-token' } })
		);

		expect(res.status).toBe(401);
	});
});
