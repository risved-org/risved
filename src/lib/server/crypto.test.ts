import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createCipheriv, randomBytes } from 'node:crypto';
import {
	encrypt,
	decrypt,
	decryptCallbackToken,
	isEncrypted,
	safeDecrypt,
	getEncryptionKey,
	_resetKeyCache
} from './crypto';

describe('crypto', () => {
	let tempDir: string;
	let keyPath: string;

	beforeEach(() => {
		_resetKeyCache();
		tempDir = mkdtempSync(join(tmpdir(), 'risved-crypto-test-'));
		keyPath = join(tempDir, 'test.key');
	});

	afterEach(() => {
		_resetKeyCache();
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe('getEncryptionKey', () => {
		it('generates a new key file if none exists', () => {
			const key = getEncryptionKey(keyPath);
			expect(key).toBeInstanceOf(Buffer);
			expect(key.length).toBe(32);
		});

		it('returns the same key on subsequent calls', () => {
			const key1 = getEncryptionKey(keyPath);
			const key2 = getEncryptionKey(keyPath);
			expect(key1.equals(key2)).toBe(true);
		});

		it('reads existing key from disk after cache reset', () => {
			const key1 = getEncryptionKey(keyPath);
			_resetKeyCache();
			const key2 = getEncryptionKey(keyPath);
			expect(key1.equals(key2)).toBe(true);
		});
	});

	describe('encrypt / decrypt', () => {
		it('round-trips a string correctly', () => {
			const plaintext = 'sk-abcdef123456';
			const encrypted = encrypt(plaintext, keyPath);
			expect(encrypted).not.toBe(plaintext);
			const decrypted = decrypt(encrypted, keyPath);
			expect(decrypted).toBe(plaintext);
		});

		it('encrypts the same string to different ciphertexts (random IV)', () => {
			const plaintext = 'my-secret-value';
			const a = encrypt(plaintext, keyPath);
			const b = encrypt(plaintext, keyPath);
			expect(a).not.toBe(b);
		});

		it('handles empty strings', () => {
			const encrypted = encrypt('', keyPath);
			expect(decrypt(encrypted, keyPath)).toBe('');
		});

		it('handles unicode strings', () => {
			const plaintext = 'secret-with-emoji-and-日本語';
			const encrypted = encrypt(plaintext, keyPath);
			expect(decrypt(encrypted, keyPath)).toBe(plaintext);
		});

		it('throws on tampered ciphertext', () => {
			const encrypted = encrypt('secret', keyPath);
			const buf = Buffer.from(encrypted, 'base64');
			buf[buf.length - 1] ^= 0xff;
			const tampered = buf.toString('base64');
			expect(() => decrypt(tampered, keyPath)).toThrow();
		});

		it('throws on truncated ciphertext', () => {
			expect(() => decrypt('dG9vc2hvcnQ=', keyPath)).toThrow();
		});
	});

	describe('isEncrypted', () => {
		it('returns true for encrypted values', () => {
			const encrypted = encrypt('test', keyPath);
			expect(isEncrypted(encrypted)).toBe(true);
		});

		it('returns false for short plaintext', () => {
			expect(isEncrypted('hello')).toBe(false);
		});

		it('returns false for non-base64 strings', () => {
			expect(isEncrypted('this is not base64!!! more text here padding')).toBe(false);
		});
	});

	describe('safeDecrypt', () => {
		it('decrypts encrypted values', () => {
			const encrypted = encrypt('secret-value', keyPath);
			expect(safeDecrypt(encrypted, keyPath)).toBe('secret-value');
		});

		it('returns plaintext for unencrypted short values', () => {
			expect(safeDecrypt('plaintext', keyPath)).toBe('plaintext');
		});

		it('returns plaintext for pre-encryption legacy values', () => {
			expect(safeDecrypt('sk-test123', keyPath)).toBe('sk-test123');
		});

		it('returns original value if decryption fails on base64-like string', () => {
			const fakeBase64 = Buffer.alloc(40, 0xff).toString('base64');
			expect(safeDecrypt(fakeBase64, keyPath)).toBe(fakeBase64);
		});
	});

	describe('decryptCallbackToken', () => {
		const secret = randomBytes(32).toString('hex');

		function encryptWebCryptoStyle(plaintext: string, hexSecret: string): string {
			const key = Buffer.from(hexSecret, 'hex');
			const iv = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
			const authTag = cipher.getAuthTag();
			// Web Crypto format: iv[12] + ciphertext[n] + authTag[16]
			return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
		}

		it('decrypts a Web Crypto AES-256-GCM token', () => {
			const plaintext = '{"userId":"user-123","projectId":"proj-abc"}';
			const token = encryptWebCryptoStyle(plaintext, secret);
			expect(decryptCallbackToken(token, secret)).toBe(plaintext);
		});

		it('throws for invalid CALLBACK_SECRET length', () => {
			expect(() => decryptCallbackToken('validbase64==', 'tooshort')).toThrow(
				'Invalid CALLBACK_SECRET'
			);
		});

		it('throws for a token that is too short', () => {
			const shortToken = Buffer.alloc(10).toString('base64');
			expect(() => decryptCallbackToken(shortToken, secret)).toThrow('too short');
		});
	});
});
