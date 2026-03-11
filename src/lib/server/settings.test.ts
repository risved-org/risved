import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn()
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	settings: { key: 'key', value: 'value' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((col: string, val: string) => ({ col, val }))
}));

import { db } from '$lib/server/db';
import { getSetting, setSetting, isOnboardingComplete } from './settings';

describe('getSetting', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns value when setting exists', async () => {
		const mockChain = {
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ value: 'test-value' }])
			})
		};
		vi.mocked(db.select).mockReturnValue(mockChain as never);

		const result = await getSetting('my-key');
		expect(result).toBe('test-value');
	});

	it('returns null when setting does not exist', async () => {
		const mockChain = {
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		};
		vi.mocked(db.select).mockReturnValue(mockChain as never);

		const result = await getSetting('missing');
		expect(result).toBeNull();
	});
});

describe('setSetting', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('inserts or updates a setting', async () => {
		const mockChain = {
			values: vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
			})
		};
		vi.mocked(db.insert).mockReturnValue(mockChain as never);

		await setSetting('key1', 'val1');
		expect(db.insert).toHaveBeenCalled();
		expect(mockChain.values).toHaveBeenCalledWith({ key: 'key1', value: 'val1' });
	});
});

describe('isOnboardingComplete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns true when setting is "true"', async () => {
		const mockChain = {
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ value: 'true' }])
			})
		};
		vi.mocked(db.select).mockReturnValue(mockChain as never);

		expect(await isOnboardingComplete()).toBe(true);
	});

	it('returns false when setting is missing', async () => {
		const mockChain = {
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		};
		vi.mocked(db.select).mockReturnValue(mockChain as never);

		expect(await isOnboardingComplete()).toBe(false);
	});

	it('returns false when setting is not "true"', async () => {
		const mockChain = {
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ value: 'false' }])
			})
		};
		vi.mocked(db.select).mockReturnValue(mockChain as never);

		expect(await isOnboardingComplete()).toBe(false);
	});
});
