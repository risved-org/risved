import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let dbPath = '';

vi.mock('$env/dynamic/private', () => ({
	env: {
		get DATABASE_URL() {
			return dbPath ? `file:${dbPath}` : undefined;
		}
	}
}));

import { getDatabasePath, getDatabaseBytes, getVolumeBytes, getBackupBytes } from './usage';

const dockerDf = JSON.stringify({
	Images: [],
	Containers: [],
	Volumes: [
		{ Name: 'risved-abc-123-data', Size: '65.47MB' },
		{ Name: 'risved-abc_123-postgres', Size: '1.5GB' },
		{ Name: 'better-auth_pgdata', Size: '999GB' },
		{ Name: 'risved-caddy', Size: '999GB' }
	],
	BuildCache: []
});

describe('getDatabasePath', () => {
	it('resolves a relative file: URL against the working directory', () => {
		expect(getDatabasePath('file:data/risved.db')).toBe(resolve('data/risved.db'));
	});

	it('returns null for non-file or memory URLs', () => {
		expect(getDatabasePath('libsql://remote.example')).toBeNull();
		expect(getDatabasePath('file::memory:')).toBeNull();
		expect(getDatabasePath(undefined)).toBeNull();
	});
});

describe('database and volume sizes', () => {
	let dir = '';

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'risved-usage-'));
		dbPath = join(dir, 'risved.db');
		await writeFile(dbPath, Buffer.alloc(1000));
		await writeFile(`${dbPath}-wal`, Buffer.alloc(200));
	});

	afterAll(async () => {
		dbPath = '';
		await rm(dir, { recursive: true, force: true });
	});

	it('adds the database file and its WAL sidecar, ignoring missing ones', async () => {
		expect(await getDatabaseBytes(dbPath)).toBe(1200);
	});

	it('returns 0 for a missing database file', async () => {
		expect(await getDatabaseBytes(join(dir, 'nope.db'))).toBe(0);
		expect(await getDatabaseBytes(null)).toBe(0);
	});

	it('sums only the risved project data and postgres volumes', async () => {
		const exec = vi.fn().mockResolvedValue(dockerDf);
		expect(await getVolumeBytes(exec)).toBe(65_470_000 + 1_500_000_000);
		expect(exec).toHaveBeenCalledWith('docker', ['system', 'df', '-v', '--format', '{{json .}}']);
	});

	it('combines the database and volume sizes', async () => {
		const exec = vi.fn().mockResolvedValue(dockerDf);
		expect(await getBackupBytes(exec)).toBe(1200 + 65_470_000 + 1_500_000_000);
	});

	it('still reports the database size when docker is unavailable', async () => {
		const exec = vi.fn().mockRejectedValue(new Error('docker: not found'));
		expect(await getBackupBytes(exec)).toBe(1200);
	});

	it('treats unparseable docker output as no volumes', async () => {
		const exec = vi.fn().mockResolvedValue('not json');
		expect(await getBackupBytes(exec)).toBe(1200);
	});
});
