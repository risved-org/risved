import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mocks ────────────────────────────────────────────────────────── */

const mockDb = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
};

function setupSelectChain(rows: unknown[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			}),
			orderBy: vi.fn().mockResolvedValue(rows)
		})
	});
}

vi.mock('$lib/server/db', () => ({ db: mockDb }));

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id', port: 'port' },
	domains: { id: 'id', projectId: 'project_id', hostname: 'hostname' }
}));

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockReturnValue({ id: 'user-1' }),
	jsonError: vi.fn((status: number, message: string) => {
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	})
}));

vi.mock('$lib/server/caddy', () => ({
	CaddyClient: vi.fn().mockImplementation(() => ({
		addRoute: vi.fn().mockResolvedValue({ success: true }),
		removeRoute: vi.fn().mockResolvedValue({ success: true })
	}))
}));

vi.mock('$lib/server/dns', () => ({
	checkDnsRecord: vi.fn().mockResolvedValue({ resolved: true }),
	getServerIps: vi.fn().mockResolvedValue({ ipv4: '1.2.3.4', ipv6: null })
}));

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(overrides: {
	method?: string;
	body?: unknown;
	params?: Record<string, string>;
} = {}) {
	const { method = 'GET', body, params = {} } = overrides;
	return {
		request: new Request('http://localhost/api/projects/p-1/domains', {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params,
		url: new URL('http://localhost/api/projects/p-1/domains')
	} as never;
}

/* ── Tests: GET /api/projects/:id/domains ─────────────────────────── */

describe('GET /api/projects/:id/domains', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns domain list', async () => {
		const domainRows = [
			{ id: 'd-1', hostname: 'app.example.com', sslStatus: 'active' }
		];

		mockDb.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue(domainRows)
				})
			}));

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(1);
		expect(data[0].hostname).toBe('app.example.com');
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

/* ── Tests: POST /api/projects/:id/domains ────────────────────────── */

describe('POST /api/projects/:id/domains', () => {
	beforeEach(() => vi.clearAllMocks());

	it('adds a domain', async () => {
		mockDb.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1', port: 3001 }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([])
					})
				})
			}));

		mockDb.insert.mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([
					{ id: 'd-1', hostname: 'app.example.com', sslStatus: 'pending' }
				])
			})
		});

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				params: { id: 'p-1' },
				body: { hostname: 'app.example.com' }
			})
		);

		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.hostname).toBe('app.example.com');
	});

	it('returns 400 for invalid hostname', async () => {
		mockDb.select.mockImplementationOnce(() => ({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 'p-1' }])
				})
			})
		}));

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				params: { id: 'p-1' },
				body: { hostname: 'not a valid hostname!' }
			})
		);

		expect(res.status).toBe(400);
	});

	it('returns 409 on duplicate hostname', async () => {
		mockDb.select
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'p-1' }])
					})
				})
			}))
			.mockImplementationOnce(() => ({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 'd-existing' }])
					})
				})
			}));

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				params: { id: 'p-1' },
				body: { hostname: 'app.example.com' }
			})
		);

		expect(res.status).toBe(409);
	});
});

/* ── Tests: DELETE /api/projects/:id/domains/:did ─────────────────── */

describe('DELETE /api/projects/:id/domains/:did', () => {
	beforeEach(() => vi.clearAllMocks());

	it('deletes a domain', async () => {
		setupSelectChain([{ id: 'd-1', hostname: 'app.example.com' }]);

		mockDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		});

		const { DELETE } = await import('./[did]/+server');
		const res = await DELETE(
			makeEvent({ method: 'DELETE', params: { id: 'p-1', did: 'd-1' } })
		);

		expect(res.status).toBe(200);
	});

	it('returns 404 for missing domain', async () => {
		setupSelectChain([]);

		const { DELETE } = await import('./[did]/+server');
		const res = await DELETE(
			makeEvent({ method: 'DELETE', params: { id: 'p-1', did: 'nope' } })
		);

		expect(res.status).toBe(404);
	});
});

/* ── Tests: POST verify ───────────────────────────────────────────── */

describe('POST /api/projects/:id/domains/:did/verify', () => {
	beforeEach(() => vi.clearAllMocks());

	it('verifies DNS and updates status', async () => {
		setupSelectChain([{ id: 'd-1', hostname: 'app.example.com', sslStatus: 'pending', verifiedAt: null }]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([
						{ id: 'd-1', hostname: 'app.example.com', sslStatus: 'provisioning' }
					])
				})
			})
		});

		const { POST } = await import('./[did]/verify/+server');
		const res = await POST(
			makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } })
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.dnsResolved).toBe(true);
	});

	it('returns 404 for missing domain', async () => {
		setupSelectChain([]);

		const { POST } = await import('./[did]/verify/+server');
		const res = await POST(
			makeEvent({ method: 'POST', params: { id: 'p-1', did: 'nope' } })
		);

		expect(res.status).toBe(404);
	});
});

/* ── Tests: POST primary ──────────────────────────────────────────── */

describe('POST /api/projects/:id/domains/:did/primary', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sets domain as primary', async () => {
		setupSelectChain([{ id: 'd-1', hostname: 'app.example.com' }]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([
						{ id: 'd-1', isPrimary: true }
					])
				})
			})
		});

		const { POST } = await import('./[did]/primary/+server');
		const res = await POST(
			makeEvent({ method: 'POST', params: { id: 'p-1', did: 'd-1' } })
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.isPrimary).toBe(true);
	});

	it('returns 404 for missing domain', async () => {
		setupSelectChain([]);

		const { POST } = await import('./[did]/primary/+server');
		const res = await POST(
			makeEvent({ method: 'POST', params: { id: 'p-1', did: 'nope' } })
		);

		expect(res.status).toBe(404);
	});
});
