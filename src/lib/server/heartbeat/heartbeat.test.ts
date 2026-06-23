import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatReporter } from './index';
import { env } from '$env/dynamic/private';

/* Mock settings store */
const store = new Map<string, string>();

vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
	setSetting: vi.fn((key: string, value: string) => {
		store.set(key, value);
		return Promise.resolve();
	})
}));

/* Mock census reporter */
vi.mock('$lib/server/census', () => ({
	getCensusReporter: () => ({
		getInstanceId: () => Promise.resolve('11111111-2222-3333-4444-555555555555'),
		getVersion: () => '0.0.8'
	})
}));

/* Mock database */
vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					orderBy: vi.fn(() => ({
						limit: vi.fn(() => Promise.resolve([]))
					}))
				}))
			}))
		}))
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: {},
	deployments: {
		status: 'status',
		createdAt: 'created_at',
		finishedAt: 'finished_at'
	}
}));

vi.mock('drizzle-orm', () => ({
	desc: vi.fn(),
	eq: vi.fn(),
	count: vi.fn(() => 'count_fn')
}));

describe('HeartbeatReporter', () => {
	let reporter: HeartbeatReporter;

	beforeEach(() => {
		store.clear();
		delete env.RISVED_MODE;
		delete env.RISVED_INSTANCE_ID;
		delete env.RISVED_HEARTBEAT_ENDPOINT;
		delete env.RISVED_HEARTBEAT_SECRET;
		reporter = new HeartbeatReporter({ heartbeatUrl: 'https://test.example.com/api/heartbeat' });
	});

	afterEach(() => {
		reporter.stop();
		vi.restoreAllMocks();
	});

	describe('isEnabled', () => {
		it('returns false by default', async () => {
			expect(await reporter.isEnabled()).toBe(false);
		});

		it('returns true when setting is true', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');
			expect(await reporter.isEnabled()).toBe(true);
		});

		it('returns false when setting is false', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'false');
			expect(await reporter.isEnabled()).toBe(false);
		});

		it('ignores enabled settings for self-host installs', async () => {
			store.set('operational_heartbeat', 'true');
			expect(await reporter.isEnabled()).toBe(false);
		});

		it('auto-enables Cloud heartbeat when identity and secret are configured', async () => {
			env.RISVED_MODE = 'cloud';
			env.RISVED_INSTANCE_ID = '11111111-2222-3333-4444-555555555555';
			env.RISVED_HEARTBEAT_SECRET = 'cloud-secret';

			expect(await reporter.isEnabled()).toBe(true);
			expect(store.get('operational_heartbeat')).toBe('true');
		});
	});

	describe('setEnabled', () => {
		it('enables heartbeat and starts timer', async () => {
			env.RISVED_MODE = 'cloud';
			expect(reporter.isRunning()).toBe(false);
			await reporter.setEnabled(true);
			expect(store.get('operational_heartbeat')).toBe('true');
			expect(reporter.isRunning()).toBe(true);
		});

		it('disables heartbeat and stops timer', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');
			await reporter.start();
			expect(reporter.isRunning()).toBe(true);

			await reporter.setEnabled(false);
			expect(store.get('operational_heartbeat')).toBe('false');
			expect(reporter.isRunning()).toBe(false);
		});

		it('does not enable heartbeat for self-host installs', async () => {
			await reporter.setEnabled(true);
			expect(store.get('operational_heartbeat')).toBe('false');
			expect(reporter.isRunning()).toBe(false);
		});
	});

	describe('start', () => {
		it('does not start when disabled', async () => {
			await reporter.start();
			expect(reporter.isRunning()).toBe(false);
		});

		it('starts when enabled', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');
			await reporter.start();
			expect(reporter.isRunning()).toBe(true);
		});

		it('does not double-start', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');
			await reporter.start();
			await reporter.start();
			expect(reporter.isRunning()).toBe(true);
		});
	});

	describe('stop', () => {
		it('stops without error when not running', () => {
			reporter.stop();
			expect(reporter.isRunning()).toBe(false);
		});
	});

	describe('getSigningSecret', () => {
		it('generates and persists a signing secret', async () => {
			const secret = await reporter.getSigningSecret();
			expect(secret).toHaveLength(64); // 32 bytes as hex
			expect(store.get('heartbeat_signing_secret')).toBe(secret);
		});

		it('returns same secret on subsequent calls', async () => {
			const s1 = await reporter.getSigningSecret();
			const s2 = await reporter.getSigningSecret();
			expect(s1).toBe(s2);
		});

		it('seeds the signing secret from Cloud env', async () => {
			env.RISVED_HEARTBEAT_SECRET = 'cloud-secret';
			const secret = await reporter.getSigningSecret();
			expect(secret).toBe('cloud-secret');
			expect(store.get('heartbeat_signing_secret')).toBe('cloud-secret');
		});
	});

	describe('sign', () => {
		it('produces a hex HMAC signature', async () => {
			const sig = await reporter.sign('{"test":true}');
			expect(sig).toMatch(/^[0-9a-f]{64}$/);
		});

		it('produces consistent signatures for same input', async () => {
			const s1 = await reporter.sign('hello');
			const s2 = await reporter.sign('hello');
			expect(s1).toBe(s2);
		});

		it('produces different signatures for different input', async () => {
			const s1 = await reporter.sign('hello');
			const s2 = await reporter.sign('world');
			expect(s1).not.toBe(s2);
		});
	});

	describe('buildPayload', () => {
		it('contains exactly the required fields', async () => {
			/* Mock db.select chain for project count */
			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(
						/* project count query returns [{value: 5}] directly (no .where) */
						Promise.resolve([{ value: 5 }])
					)
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([{ finishedAt: '2026-04-18T12:10:00Z' }])
							})
						})
					})
			} as any);

			const payload = await reporter.buildPayload();
			const keys = Object.keys(payload).sort();
			expect(keys).toEqual([
				'instance_id',
				'last_deploy_at',
				'project_count',
				'timestamp',
				'total_backup_bytes',
				'total_bandwidth_bytes_30d',
				'uptime_seconds',
				'version'
			]);
		});

		it('uses the census instance_id', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 0 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			const payload = await reporter.buildPayload();
			expect(payload.instance_id).toBe('11111111-2222-3333-4444-555555555555');
			expect(payload.version).toBe('0.0.8');
		});

		it('has uptime_seconds as a positive number', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 0 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			const payload = await reporter.buildPayload();
			expect(payload.uptime_seconds).toBeGreaterThanOrEqual(0);
		});

		it('returns null for last_deploy_at when no deployments', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 0 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			const payload = await reporter.buildPayload();
			expect(payload.last_deploy_at).toBeNull();
		});

		it('sets backup and bandwidth to 0 (not yet tracked)', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 0 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			const payload = await reporter.buildPayload();
			expect(payload.total_backup_bytes).toBe(0);
			expect(payload.total_bandwidth_bytes_30d).toBe(0);
		});
	});

	describe('beat', () => {
		it('uses the configured Cloud heartbeat endpoint by default', async () => {
			env.RISVED_MODE = 'cloud';
			env.RISVED_HEARTBEAT_ENDPOINT = 'https://cloud.example.com/api/heartbeat';
			store.set('operational_heartbeat', 'true');
			reporter = new HeartbeatReporter();

			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 0 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response('OK', { status: 200 }));

			await reporter.beat();

			const [url] = fetchSpy.mock.calls[0];
			expect(url).toBe('https://cloud.example.com/api/heartbeat');
		});

		it('does not send when disabled', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			const result = await reporter.beat();
			expect(result).toBe(false);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('sends POST with signature header when enabled', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');

			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 3 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response('OK', { status: 200 }));

			const result = await reporter.beat();
			expect(result).toBe(true);
			expect(fetchSpy).toHaveBeenCalledOnce();

			const [url, opts] = fetchSpy.mock.calls[0];
			expect(url).toBe('https://test.example.com/api/heartbeat');
			expect(opts?.method).toBe('POST');
			expect((opts?.headers as Record<string, string>).Authorization).toBe(
				'Bearer 11111111-2222-3333-4444-555555555555'
			);
			expect((opts?.headers as Record<string, string>)['X-Signature']).toMatch(/^[0-9a-f]{64}$/);

			const body = JSON.parse(opts?.body as string);
			expect(body.instance_id).toBe('11111111-2222-3333-4444-555555555555');
			expect(body.project_count).toBe(3);

			expect(store.get('heartbeat_last_ping')).toBeTruthy();
		});

		it('returns false on network error', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');

			const { db } = await import('$lib/server/db');
			vi.mocked(db.select).mockReturnValue({
				from: vi
					.fn()
					.mockReturnValueOnce(Promise.resolve([{ value: 0 }]))
					.mockReturnValueOnce({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockResolvedValue([])
							})
						})
					})
			} as any);

			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

			const result = await reporter.beat();
			expect(result).toBe(false);
		});
	});

	describe('getInfo', () => {
		it('returns disabled state by default', async () => {
			const info = await reporter.getInfo();
			expect(info.enabled).toBe(false);
			expect(info.lastPing).toBeNull();
		});

		it('returns enabled state when on', async () => {
			env.RISVED_MODE = 'cloud';
			store.set('operational_heartbeat', 'true');
			store.set('heartbeat_last_ping', '2026-04-18T14:00:00.000Z');
			const info = await reporter.getInfo();
			expect(info.enabled).toBe(true);
			expect(info.lastPing).toBe('2026-04-18T14:00:00.000Z');
		});
	});
});
