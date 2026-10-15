import { describe, expect, it } from 'vitest'
import { runtimeError } from './project-runtime'

describe('runtime validation', () => {
	it.each([null, '', 'deno', 'Bun', {}, 'bun:latest'])('rejects invalid choice %j', value => {
		expect(runtimeError(value)).toBe('Choose Node.js or Bun as the runtime.')
	})
	it('allows an explicit Bun choice before framework detection', () => {
		expect(runtimeError('bun')).toBeNull()
	})
	it('keeps default runtime valid for Deno and hybrid projects', () => {
		expect(runtimeError('node', 'fresh', 'deno')).toBeNull()
		expect(runtimeError('node', 'astro', 'hybrid')).toBeNull()
	})
})
