import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	existsSync: vi.fn()
}));

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { getEncryptionKey, _resetKeyCache } from './crypto';

const DATA_KEY_PATH = resolve(process.cwd(), 'data', '.risved-encryption.key');
const LEGACY_KEY_PATH = resolve(process.cwd(), '.risved-encryption.key');

function enoent(): Error {
	return Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
}

/* getEncryptionKey() with no keyPath is what every real caller (encrypt,
 * decrypt, safeDecrypt) uses in production, so its data-dir/legacy-path
 * resolution deserves direct coverage rather than only the keyPath-arg
 * branch exercised elsewhere. */
describe('getEncryptionKey (default path resolution)', () => {
	beforeEach(() => {
		_resetKeyCache();
		vi.mocked(readFileSync).mockReset();
		vi.mocked(writeFileSync).mockReset();
		vi.mocked(mkdirSync).mockReset();
		vi.mocked(existsSync).mockReset();
	});

	it('returns the cached key on a second call with no keyPath', () => {
		vi.mocked(readFileSync).mockImplementation((path) => {
			if (path === DATA_KEY_PATH) return Buffer.alloc(32, 1);
			throw enoent();
		});

		const first = getEncryptionKey();
		const second = getEncryptionKey();

		expect(first.equals(second)).toBe(true);
		expect(readFileSync).toHaveBeenCalledTimes(1);
	});

	it('finds a key at the legacy path and copies it into the data dir', () => {
		const legacyKey = Buffer.alloc(32, 2);
		vi.mocked(readFileSync).mockImplementation((path) => {
			if (path === LEGACY_KEY_PATH) return legacyKey;
			throw enoent();
		});

		const key = getEncryptionKey();

		expect(key.equals(legacyKey)).toBe(true);
		expect(mkdirSync).toHaveBeenCalled();
		expect(writeFileSync).toHaveBeenCalledWith(DATA_KEY_PATH, legacyKey, { mode: 0o600 });
	});

	it('tolerates a failed best-effort copy from the legacy path', () => {
		const legacyKey = Buffer.alloc(32, 3);
		vi.mocked(readFileSync).mockImplementation((path) => {
			if (path === LEGACY_KEY_PATH) return legacyKey;
			throw enoent();
		});
		vi.mocked(writeFileSync).mockImplementation(() => {
			throw new Error('disk full');
		});

		const key = getEncryptionKey();

		expect(key.equals(legacyKey)).toBe(true);
	});

	it('generates a new key in the data dir when none is found and the dir exists', () => {
		vi.mocked(readFileSync).mockImplementation(() => {
			throw enoent();
		});
		vi.mocked(existsSync).mockReturnValue(true);

		const key = getEncryptionKey();

		expect(key.length).toBe(32);
		expect(writeFileSync).toHaveBeenCalledWith(DATA_KEY_PATH, expect.any(Buffer), { mode: 0o600 });
	});

	it('falls back to the legacy path when the data dir does not exist', () => {
		vi.mocked(readFileSync).mockImplementation(() => {
			throw enoent();
		});
		vi.mocked(existsSync).mockReturnValue(false);

		const key = getEncryptionKey();

		expect(key.length).toBe(32);
		expect(writeFileSync).toHaveBeenCalledWith(LEGACY_KEY_PATH, expect.any(Buffer), { mode: 0o600 });
	});
});
