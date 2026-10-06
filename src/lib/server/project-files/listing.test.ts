import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { volumeScript } from './volume-script'

/** Execute the real helper against a lazy directory without allocating its entries. */
async function listing(page = 1, count = 1_000_000) {
	let reads = 0
	let stats = 0
	let closed = false
	let output = ''
	const fs = {
		constants: {},
		openSync: () => 1,
		closeSync: () => {},
		opendirSync: () => ({
			readSync: () => {
				if (reads === count) return null
				const name = `file-${String(reads++).padStart(7, '0')}`
				return { name, isFile: () => true, isDirectory: () => false }
			},
			closeSync: () => {
				closed = true
			}
		}),
		lstatSync: () => {
			stats++
			return { isFile: () => true, isDirectory: () => false, size: 0, mtime: new Date(0) }
		}
	}
	await runInNewContext(volumeScript, {
		require: (name: string) => (name === 'node:fs' ? fs : {}),
		process: {
			stdin: {
				setEncoding: () => {},
				async *[Symbol.asyncIterator]() {
					yield JSON.stringify({ operation: 'list', path: '', page })
				}
			},
			stdout: {
				write: (value: string) => {
					output = value
				}
			}
		}
	})
	return { result: JSON.parse(output), reads, stats, closed }
}

describe('bounded directory listing', () => {
	it('stops after a page and lookahead in a million-entry directory', async () => {
		const { result, reads, stats, closed } = await listing()
		expect(result.entries).toHaveLength(1000)
		expect(result.hasNext).toBe(true)
		expect(reads).toBe(1001)
		expect(stats).toBe(1001)
		expect(closed).toBe(true)
	})
	it('skips earlier entries without statting them and returns the next page', async () => {
		const { result, reads, stats } = await listing(2)
		expect(result.entries[0].name).toBe('file-0001000')
		expect(result.entries).toHaveLength(1000)
		expect(reads).toBe(2001)
		expect(stats).toBe(1001)
	})
	it('does not offer a next page at an exact page boundary', async () => {
		const { result } = await listing(1, 1000)
		expect(result.hasNext).toBe(false)
		expect(result.entries).toHaveLength(1000)
	})
})
