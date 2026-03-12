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
	projects: { id: 'id' },
	envVars: { id: 'id', projectId: 'project_id', key: 'key' }
}));

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockReturnValue({ id: 'user-1', email: 'admin@test.com' }),
	jsonError: vi.fn((status: number, message: string) => {
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	})
}));

/* Mock crypto — encrypt prefixes with "enc:", safeDecrypt strips it */
vi.mock('$lib/server/crypto', () => ({
	encrypt: vi.fn((v: string) => `enc:${v}`),
	decrypt: vi.fn((v: string) => (v.startsWith('enc:') ? v.slice(4) : v)),
	safeDecrypt: vi.fn((v: string) => (v.startsWith('enc:') ? v.slice(4) : v))
}));

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(
	overrides: {
		method?: string;
		body?: unknown;
		params?: Record<string, string>;
	} = {}
) {
	const { method = 'GET', body, params = {} } = overrides;
	return {
		request: new Request('http://localhost/api/projects/p-1/env', {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params,
		url: new URL('http://localhost/api/projects/p-1/env')
	} as never;
}

/* ── Tests: GET /api/projects/:id/env ─────────────────────────────── */

describe('GET /api/projects/:id/env', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns env vars with secrets masked and values decrypted', async () => {
		const envRows = [
			{ id: 'e-1', projectId: 'p-1', key: 'PORT', value: 'enc:3000', isSecret: false },
			{
				id: 'e-2',
				projectId: 'p-1',
				key: 'API_KEY',
				value: 'enc:sk-abcdef123456',
				isSecret: true
			}
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
					where: vi.fn().mockResolvedValue(envRows)
				})
			}));

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'p-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(2);

		const portVar = data.find((e: { key: string }) => e.key === 'PORT');
		expect(portVar.value).toBe('3000');

		const apiKeyVar = data.find((e: { key: string }) => e.key === 'API_KEY');
		expect(apiKeyVar.value).toContain('••••');
		expect(apiKeyVar.value).not.toContain('abcdef123456');
	});

	it('returns 404 for missing project', async () => {
		setupSelectChain([]);

		const { GET } = await import('./+server');
		const res = await GET(makeEvent({ params: { id: 'nope' } }));

		expect(res.status).toBe(404);
	});
});

/* ── Tests: POST /api/projects/:id/env ────────────────────────────── */

describe('POST /api/projects/:id/env', () => {
	beforeEach(() => vi.clearAllMocks());

	it('creates an env var with encrypted value', async () => {
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
						limit: vi.fn().mockResolvedValue([])
					})
				})
			}));

		mockDb.insert.mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi
					.fn()
					.mockResolvedValue([
						{ id: 'e-1', projectId: 'p-1', key: 'PORT', value: 'enc:3000', isSecret: false }
					])
			})
		});

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				params: { id: 'p-1' },
				body: { key: 'PORT', value: '3000' }
			})
		);

		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.key).toBe('PORT');
		expect(data.value).toBe('3000');
	});

	it('stores encrypted value in database', async () => {
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
						limit: vi.fn().mockResolvedValue([])
					})
				})
			}));

		const valuesFn = vi.fn().mockReturnValue({
			returning: vi
				.fn()
				.mockResolvedValue([
					{ id: 'e-1', projectId: 'p-1', key: 'SECRET', value: 'enc:my-secret', isSecret: true }
				])
		});
		mockDb.insert.mockReturnValue({ values: valuesFn });

		const { POST } = await import('./+server');
		await POST(
			makeEvent({
				method: 'POST',
				params: { id: 'p-1' },
				body: { key: 'SECRET', value: 'my-secret', is_secret: true }
			})
		);

		expect(valuesFn).toHaveBeenCalledWith(
			expect.objectContaining({
				value: 'enc:my-secret'
			})
		);
	});

	it('returns 400 for missing key', async () => {
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
				body: { value: '3000' }
			})
		);

		expect(res.status).toBe(400);
	});

	it('returns 400 for invalid key format', async () => {
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
				body: { key: 'invalid-key!', value: 'val' }
			})
		);

		expect(res.status).toBe(400);
	});

	it('returns 409 on duplicate key', async () => {
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
						limit: vi.fn().mockResolvedValue([{ id: 'e-1', key: 'PORT' }])
					})
				})
			}));

		const { POST } = await import('./+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				params: { id: 'p-1' },
				body: { key: 'PORT', value: '3000' }
			})
		);

		expect(res.status).toBe(409);
	});
});

/* ── Tests: PUT /api/projects/:id/env/:eid ────────────────────────── */

describe('PUT /api/projects/:id/env/:eid', () => {
	beforeEach(() => vi.clearAllMocks());

	it('updates an env var with encrypted value', async () => {
		setupSelectChain([{ id: 'e-1', key: 'PORT', value: 'enc:3000', isSecret: false }]);

		mockDb.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi
						.fn()
						.mockResolvedValue([{ id: 'e-1', key: 'PORT', value: 'enc:8080', isSecret: false }])
				})
			})
		});

		const { PUT } = await import('./[eid]/+server');
		const res = await PUT(
			makeEvent({
				method: 'PUT',
				params: { id: 'p-1', eid: 'e-1' },
				body: { value: '8080' }
			})
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.value).toBe('8080');
	});

	it('encrypts the value before storing', async () => {
		setupSelectChain([{ id: 'e-1', key: 'PORT', value: 'enc:3000', isSecret: false }]);

		const setFn = vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				returning: vi
					.fn()
					.mockResolvedValue([{ id: 'e-1', key: 'PORT', value: 'enc:8080', isSecret: false }])
			})
		});
		mockDb.update.mockReturnValue({ set: setFn });

		const { PUT } = await import('./[eid]/+server');
		await PUT(
			makeEvent({
				method: 'PUT',
				params: { id: 'p-1', eid: 'e-1' },
				body: { value: '8080' }
			})
		);

		expect(setFn).toHaveBeenCalledWith(
			expect.objectContaining({
				value: 'enc:8080'
			})
		);
	});

	it('returns 404 for missing env var', async () => {
		setupSelectChain([]);

		const { PUT } = await import('./[eid]/+server');
		const res = await PUT(
			makeEvent({
				method: 'PUT',
				params: { id: 'p-1', eid: 'nope' },
				body: { value: 'x' }
			})
		);

		expect(res.status).toBe(404);
	});
});

/* ── Tests: DELETE /api/projects/:id/env/:eid ─────────────────────── */

describe('DELETE /api/projects/:id/env/:eid', () => {
	beforeEach(() => vi.clearAllMocks());

	it('deletes an env var', async () => {
		setupSelectChain([{ id: 'e-1' }]);

		mockDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		});

		const { DELETE } = await import('./[eid]/+server');
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'p-1', eid: 'e-1' } }));

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
	});

	it('returns 404 for missing env var', async () => {
		setupSelectChain([]);

		const { DELETE } = await import('./[eid]/+server');
		const res = await DELETE(makeEvent({ method: 'DELETE', params: { id: 'p-1', eid: 'nope' } }));

		expect(res.status).toBe(404);
	});
});
