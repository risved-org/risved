import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

/* ── Mocks ────────────────────────────────────────────────────────── */

/* Hoisted: the mock factory below runs before module-level consts otherwise. */
const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: mockDb }));

vi.mock('$lib/server/db/schema', () => ({
	apiKeys: {
		id: 'id',
		userId: 'user_id',
		label: 'label',
		keyHash: 'key_hash',
		keyPrefix: 'key_prefix',
		lastUsedAt: 'last_used_at',
		revokedAt: 'revoked_at',
		createdAt: 'created_at'
	}
}));

vi.mock('drizzle-orm', () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((c: unknown) => ({ desc: c })),
	eq: vi.fn((c: unknown, v: unknown) => ({ eq: [c, v] })),
	isNull: vi.fn((c: unknown) => ({ isNull: c }))
}));

import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from './api-keys';

type Row = {
	id: string;
	userId: string;
	label: string;
	keyHash: string;
	keyPrefix: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
	createdAt: string;
};

function row(overrides: Partial<Row> = {}): Row {
	return {
		id: 'k-1',
		userId: 'u-1',
		label: 'CI',
		keyHash: 'deadbeef',
		keyPrefix: 'rsv_abc123',
		lastUsedAt: null,
		revokedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

/** Chain: select().from().where().limit() / .orderBy() */
function selectReturning(rows: Row[]) {
	mockDb.select.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
				orderBy: vi.fn().mockResolvedValue(rows)
			})
		})
	});
}

function updateReturning(rows: Array<{ id: string }>) {
	const returning = vi.fn().mockResolvedValue(rows);
	const where = vi.fn().mockReturnValue({ returning, catch: vi.fn() });
	mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
	return { where, returning };
}

beforeEach(() => {
	vi.clearAllMocks();
	/* verifyApiKey refreshes lastUsedAt in the background; make that a no-op. */
	updateReturning([]);
});

describe('createApiKey', () => {
	it('returns an rsv_ key and stores only its digest', async () => {
		let inserted: Record<string, unknown> = {};
		mockDb.insert.mockReturnValue({
			values: vi.fn((v: Record<string, unknown>) => {
				inserted = v;
				return { returning: vi.fn().mockResolvedValue([row({ ...v } as Partial<Row>)]) };
			})
		});

		const { key, record } = await createApiKey('u-1', '  CI pipeline  ');

		expect(key.startsWith('rsv_')).toBe(true);
		expect(key.length).toBeGreaterThan(40);
		expect(inserted.keyHash).toBe(createHash('sha256').update(key).digest('hex'));
		expect(inserted.keyHash).not.toContain(key);
		expect(inserted.label).toBe('CI pipeline');
		expect(record.keyPrefix).toBe(key.slice(0, 10));
	});

	it('rejects a blank label', async () => {
		await expect(createApiKey('u-1', '   ')).rejects.toThrow('label is required');
	});
});

describe('verifyApiKey', () => {
	it('resolves a live key to its user', async () => {
		const key = 'rsv_' + 'a'.repeat(43);
		selectReturning([row({ keyHash: createHash('sha256').update(key).digest('hex') })]);

		await expect(verifyApiKey(key)).resolves.toEqual({ userId: 'u-1', id: 'k-1' });
	});

	it('rejects a revoked key', async () => {
		const key = 'rsv_' + 'b'.repeat(43);
		selectReturning([
			row({
				keyHash: createHash('sha256').update(key).digest('hex'),
				revokedAt: '2026-02-01T00:00:00.000Z'
			})
		]);

		await expect(verifyApiKey(key)).resolves.toBeNull();
	});

	it('rejects an unknown key', async () => {
		selectReturning([]);

		await expect(verifyApiKey('rsv_' + 'c'.repeat(43))).resolves.toBeNull();
	});

	it('rejects anything without the rsv_ prefix without hitting the database', async () => {
		await expect(verifyApiKey('Bearer-ish-token')).resolves.toBeNull();
		expect(mockDb.select).not.toHaveBeenCalled();
	});
});

describe('listApiKeys', () => {
	it('never returns key material', async () => {
		selectReturning([row(), row({ id: 'k-2', label: 'laptop' })]);

		const keys = await listApiKeys('u-1');

		expect(keys).toHaveLength(2);
		for (const key of keys) {
			expect(Object.keys(key)).not.toContain('keyHash');
		}
	});
});

describe('revokeApiKey', () => {
	it('reports success when a row was revoked', async () => {
		updateReturning([{ id: 'k-1' }]);

		await expect(revokeApiKey('u-1', 'k-1')).resolves.toBe(true);
	});

	it('reports failure for a key belonging to someone else', async () => {
		updateReturning([]);

		await expect(revokeApiKey('u-2', 'k-1')).resolves.toBe(false);
	});
});
