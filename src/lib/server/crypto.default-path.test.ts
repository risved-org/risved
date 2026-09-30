import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, resolve } from 'node:path';

const state = {
	files: new Map<string, Buffer>(),
	dirsExist: new Set<string>()
};

vi.mock('node:fs', () => ({
	readFileSync: vi.fn((path: string) => {
		const file = state.files.get(path);
		if (file) return file;
		const err = new Error('ENOENT') as NodeJS.ErrnoException;
		err.code = 'ENOENT';
		throw err;
	}),
	writeFileSync: vi.fn((path: string, data: Buffer) => {
		state.files.set(path, data);
	}),
	mkdirSync: vi.fn((path: string) => {
		state.dirsExist.add(path);
	}),
	existsSync: vi.fn((path: string) => state.dirsExist.has(path))
}));

const { getEncryptionKey, _resetKeyCache } = await import('./crypto');

const DATA_KEY_PATH = resolve(process.cwd(), 'data', '.risved-encryption.key');
const LEGACY_KEY_PATH = resolve(process.cwd(), '.risved-encryption.key');

describe('getEncryptionKey default path resolution', () => {
	beforeEach(() => {
		_resetKeyCache();
		state.files.clear();
		state.dirsExist.clear();
	});

	it('generates a new key at the legacy path when the data dir does not exist', () => {
		const key = getEncryptionKey();
		expect(key.length).toBe(32);
		expect(state.files.has(LEGACY_KEY_PATH)).toBe(true);
		expect(state.files.has(DATA_KEY_PATH)).toBe(false);
	});

	it('generates a new key in the data dir when it exists', () => {
		state.dirsExist.add(dirname(DATA_KEY_PATH));
		const key = getEncryptionKey();
		expect(key.length).toBe(32);
		expect(state.files.has(DATA_KEY_PATH)).toBe(true);
	});

	it('reads an existing key from the data dir without touching the legacy path', () => {
		const existingKey = Buffer.alloc(32, 7);
		state.files.set(DATA_KEY_PATH, existingKey);
		const key = getEncryptionKey();
		expect(key.equals(existingKey)).toBe(true);
		expect(state.files.has(LEGACY_KEY_PATH)).toBe(false);
	});

	it('migrates a key found at the legacy path into the data dir', () => {
		const existingKey = Buffer.alloc(32, 9);
		state.files.set(LEGACY_KEY_PATH, existingKey);
		const key = getEncryptionKey();
		expect(key.equals(existingKey)).toBe(true);
		expect(state.files.get(DATA_KEY_PATH)?.equals(existingKey)).toBe(true);
	});

	it('caches the resolved key across calls without a keyPath', () => {
		const key1 = getEncryptionKey();
		const key2 = getEncryptionKey();
		expect(key1).toBe(key2);
	});
});
