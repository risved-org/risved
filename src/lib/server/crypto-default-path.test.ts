import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockExistsSync = vi.fn()

vi.mock('node:fs', () => ({
	readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
	writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
	mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
	existsSync: (...args: unknown[]) => mockExistsSync(...args)
}))

import { getEncryptionKey, _resetKeyCache } from './crypto'

function enoent(): NodeJS.ErrnoException {
	const err = new Error('not found') as NodeJS.ErrnoException
	err.code = 'ENOENT'
	return err
}

beforeEach(() => {
	_resetKeyCache()
	vi.clearAllMocks()
})

describe('getEncryptionKey (default path resolution, fs mocked)', () => {
	it('returns the cached key on a second no-arg call without touching the filesystem again', () => {
		const key = Buffer.alloc(32, 7)
		mockReadFileSync.mockReturnValueOnce(key)

		const first = getEncryptionKey()
		mockReadFileSync.mockClear()
		const second = getEncryptionKey()

		expect(second.equals(first)).toBe(true)
		expect(mockReadFileSync).not.toHaveBeenCalled()
	})

	it('reads from the persistent data dir when a valid key already lives there', () => {
		const key = Buffer.alloc(32, 1)
		mockReadFileSync.mockReturnValueOnce(key)

		const result = getEncryptionKey()

		expect(result.equals(key)).toBe(true)
		expect(mockWriteFileSync).not.toHaveBeenCalled()
	})

	it('falls back to the legacy path and migrates the key into the data dir', () => {
		const key = Buffer.alloc(32, 2)
		mockReadFileSync.mockImplementationOnce(() => { throw enoent() })
		mockReadFileSync.mockReturnValueOnce(key)

		const result = getEncryptionKey()

		expect(result.equals(key)).toBe(true)
		expect(mockMkdirSync).toHaveBeenCalled()
		expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining('data'), key, { mode: 0o600 })
	})

	it('ignores migration write failures and still returns the legacy key', () => {
		const key = Buffer.alloc(32, 3)
		mockReadFileSync.mockImplementationOnce(() => { throw enoent() })
		mockReadFileSync.mockReturnValueOnce(key)
		mockWriteFileSync.mockImplementationOnce(() => { throw new Error('disk full') })

		const result = getEncryptionKey()

		expect(result.equals(key)).toBe(true)
	})

	it('skips a candidate file with the wrong length and generates a new key when none is valid', () => {
		mockReadFileSync.mockImplementationOnce(() => Buffer.alloc(4))
		mockReadFileSync.mockImplementationOnce(() => { throw enoent() })
		mockReadFileSync.mockImplementationOnce(() => { throw enoent() })
		mockExistsSync.mockReturnValueOnce(true)

		const result = getEncryptionKey()

		expect(result.length).toBe(32)
		expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining('data'), expect.any(Buffer), { mode: 0o600 })
	})

	it('generates a new key at the legacy path when the data directory does not exist', () => {
		mockReadFileSync.mockImplementation(() => { throw enoent() })
		mockExistsSync.mockReturnValueOnce(false)

		const result = getEncryptionKey()

		expect(result.length).toBe(32)
		const writtenPath = mockWriteFileSync.mock.calls[0][0] as string
		expect(writtenPath).not.toContain('data')
	})
})
