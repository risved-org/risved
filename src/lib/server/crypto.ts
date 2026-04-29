import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Default path for the encryption key file, next to the DB */
const DEFAULT_KEY_PATH = resolve(process.cwd(), '.risved-encryption.key');

let cachedKey: Buffer | null = null;
let cachedKeyPath: string | null = null;

/**
 * Get or generate the server encryption key.
 * Key is stored as a raw 32-byte file outside the database.
 */
export function getEncryptionKey(keyPath?: string): Buffer {
	const path = keyPath ?? DEFAULT_KEY_PATH;

	if (cachedKey && cachedKeyPath === path) return cachedKey;

	try {
		const key = readFileSync(path);
		if (key.length !== KEY_LENGTH) {
			throw new Error(`Invalid key length: expected ${KEY_LENGTH}, got ${key.length}`);
		}
		cachedKey = key;
		cachedKeyPath = path;
		return key;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			const key = generateKey(path);
			cachedKey = key;
			cachedKeyPath = path;
			return key;
		}
		throw err;
	}
}

/**
 * Generate a new 256-bit encryption key and write it to disk.
 */
function generateKey(keyPath: string): Buffer {
	const key = randomBytes(KEY_LENGTH);
	mkdirSync(dirname(keyPath), { recursive: true });
	writeFileSync(keyPath, key, { mode: 0o600 });
	return key;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing iv + authTag + ciphertext.
 */
export function encrypt(plaintext: string, keyPath?: string): string {
	const key = getEncryptionKey(keyPath);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	/* Format: iv (12) + authTag (16) + ciphertext (variable) */
	const combined = Buffer.concat([iv, authTag, encrypted]);
	return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 * Returns the original plaintext string.
 */
export function decrypt(encoded: string, keyPath?: string): string {
	const key = getEncryptionKey(keyPath);
	const combined = Buffer.from(encoded, 'base64');

	if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error('Invalid encrypted data: too short');
	}

	const iv = combined.subarray(0, IV_LENGTH);
	const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return decrypted.toString('utf8');
}

/**
 * Decrypt a callback token from risved.com.
 * risved.com encrypts with Web Crypto (AES-256-GCM) which produces:
 *   base64(iv[12] + ciphertext[n] + authTag[16])
 * Node's createDecipheriv requires splitting authTag from ciphertext manually.
 * The CALLBACK_SECRET is a hex-encoded 32-byte key.
 */
export function decryptCallbackToken(encoded: string, secret: string): string {
	const key = Buffer.from(secret, 'hex')
	if (key.length !== KEY_LENGTH) {
		throw new Error(`Invalid CALLBACK_SECRET: expected ${KEY_LENGTH} bytes, got ${key.length}`)
	}

	const combined = Buffer.from(encoded, 'base64')
	if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error('Invalid callback token: too short')
	}

	/* Web Crypto AES-GCM format: iv[12] + ciphertext_with_authtag */
	const iv = combined.subarray(0, IV_LENGTH)
	const ciphertextWithTag = combined.subarray(IV_LENGTH)
	const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_LENGTH)
	const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_LENGTH)

	const decipher = createDecipheriv(ALGORITHM, key, iv)
	decipher.setAuthTag(authTag)

	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
	return decrypted.toString('utf8')
}

/**
 * Check if a value looks like an encrypted string (base64 with minimum length).
 * Used during migration to detect already-encrypted values.
 */
export function isEncrypted(value: string): boolean {
	if (value.length < 40) return false;
	try {
		const buf = Buffer.from(value, 'base64');
		return buf.length >= IV_LENGTH + AUTH_TAG_LENGTH && buf.toString('base64') === value;
	} catch {
		return false;
	}
}

/**
 * Safely decrypt a value, returning the original if decryption fails.
 * Handles backward compatibility with pre-encryption plaintext values.
 */
export function safeDecrypt(value: string, keyPath?: string): string {
	if (!isEncrypted(value)) return value;
	try {
		return decrypt(value, keyPath);
	} catch {
		return value;
	}
}

/**
 * Reset the cached key (for testing).
 */
export function _resetKeyCache(): void {
	cachedKey = null;
	cachedKeyPath = null;
}
