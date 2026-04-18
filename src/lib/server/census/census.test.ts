import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CensusReporter } from './index'

/* Mock settings store */
const store = new Map<string, string>()

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
	setSetting: vi.fn((key: string, value: string) => {
		store.set(key, value)
		return Promise.resolve()
	})
}))

describe('CensusReporter', () => {
	let reporter: CensusReporter

	beforeEach(() => {
		store.clear()
		reporter = new CensusReporter({ censusUrl: 'https://test.example.com/api/census' })
	})

	afterEach(() => {
		reporter.stop()
		vi.restoreAllMocks()
	})

	describe('getInstanceId', () => {
		it('generates a UUID on first call and persists it', async () => {
			const id = await reporter.getInstanceId()
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
			expect(store.get('census_instance_id')).toBe(id)
		})

		it('returns the same UUID on subsequent calls', async () => {
			const id1 = await reporter.getInstanceId()
			const id2 = await reporter.getInstanceId()
			expect(id1).toBe(id2)
		})

		it('uses existing UUID from settings', async () => {
			const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
			store.set('census_instance_id', existing)
			const id = await reporter.getInstanceId()
			expect(id).toBe(existing)
		})
	})

	describe('getVersion', () => {
		it('returns a semver string', () => {
			const version = reporter.getVersion()
			expect(version).toMatch(/^\d+\.\d+\.\d+/)
		})
	})

	describe('buildPayload', () => {
		it('contains exactly instance_id, version, and timestamp', async () => {
			const payload = await reporter.buildPayload()
			const keys = Object.keys(payload).sort()
			expect(keys).toEqual(['instance_id', 'timestamp', 'version'])
		})

		it('has a valid ISO timestamp', async () => {
			const payload = await reporter.buildPayload()
			const parsed = new Date(payload.timestamp)
			expect(parsed.toISOString()).toBe(payload.timestamp)
		})

		it('has a valid UUID as instance_id', async () => {
			const payload = await reporter.buildPayload()
			expect(payload.instance_id).toMatch(/^[0-9a-f]{8}-/)
		})
	})

	describe('ping', () => {
		it('sends POST to census URL with correct payload', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('OK', { status: 200 })
			)

			const result = await reporter.ping()

			expect(result).toBe(true)
			expect(fetchSpy).toHaveBeenCalledOnce()

			const [url, opts] = fetchSpy.mock.calls[0]
			expect(url).toBe('https://test.example.com/api/census')
			expect(opts?.method).toBe('POST')
			expect(opts?.headers).toEqual({ 'Content-Type': 'application/json' })

			const body = JSON.parse(opts?.body as string)
			expect(Object.keys(body).sort()).toEqual(['instance_id', 'timestamp', 'version'])

			/* Verify last ping timestamp was saved */
			expect(store.get('census_last_ping')).toBeTruthy()
		})

		it('returns false on network error without throwing', async () => {
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

			const result = await reporter.ping()
			expect(result).toBe(false)
		})

		it('returns false on non-ok response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('Server Error', { status: 500 })
			)

			const result = await reporter.ping()
			expect(result).toBe(false)
		})
	})

	describe('getInfo', () => {
		it('returns census info for settings page', async () => {
			const info = await reporter.getInfo()
			expect(info).toHaveProperty('instanceId')
			expect(info).toHaveProperty('version')
			expect(info).toHaveProperty('lastPing')
			expect(info.lastPing).toBeNull()
		})

		it('includes lastPing when available', async () => {
			store.set('census_last_ping', '2026-04-18T14:00:00.000Z')
			const info = await reporter.getInfo()
			expect(info.lastPing).toBe('2026-04-18T14:00:00.000Z')
		})
	})

	describe('start/stop', () => {
		it('starts and stops without errors', () => {
			expect(reporter.isRunning()).toBe(false)
			reporter.start()
			expect(reporter.isRunning()).toBe(true)
			reporter.stop()
			expect(reporter.isRunning()).toBe(false)
		})

		it('does not double-start', () => {
			reporter.start()
			reporter.start()
			expect(reporter.isRunning()).toBe(true)
			reporter.stop()
		})
	})
})
