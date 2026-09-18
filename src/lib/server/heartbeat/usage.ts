import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { parseDockerSize } from '$lib/server/metrics/size';

const execFileAsync = promisify(execFile);

export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

const defaultExec: ExecFn = async (cmd, args) => {
	const { stdout } = await execFileAsync(cmd, args, {
		timeout: 60_000,
		maxBuffer: 16 * 1024 * 1024
	});
	return stdout;
};

/** Named volumes the control plane creates: project data and managed Postgres. */
const RISVED_VOLUME_RE = /^risved-.+-(data|postgres)$/;

/** Resolve the SQLite file path from a libSQL URL such as "file:data/risved.db". */
export function getDatabasePath(databaseUrl: string | undefined = env.DATABASE_URL): string | null {
	if (!databaseUrl?.startsWith('file:')) return null;

	const path = databaseUrl.slice('file:'.length);
	if (!path || path === ':memory:') return null;

	return resolve(path);
}

/** Size of the control plane database, including its WAL and shared-memory sidecars. */
export async function getDatabaseBytes(dbPath: string | null = getDatabasePath()): Promise<number> {
	if (!dbPath) return 0;

	let total = 0;
	for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
		try {
			total += (await stat(file)).size;
		} catch {
			/* sidecar files only exist while the database is open in WAL mode */
		}
	}
	return total;
}

/** Combined size of the Docker volumes holding project data and managed Postgres. */
export async function getVolumeBytes(exec: ExecFn = defaultExec): Promise<number> {
	const stdout = await exec('docker', ['system', 'df', '-v', '--format', '{{json .}}']);
	const usage = JSON.parse(stdout) as { Volumes?: Array<{ Name?: string; Size?: string }> };

	let total = 0;
	for (const volume of usage.Volumes ?? []) {
		if (!volume.Name || !RISVED_VOLUME_RE.test(volume.Name)) continue;
		total += parseDockerSize(volume.Size ?? '0B');
	}
	return total;
}

/**
 * Bytes of persistent state a backup of this instance covers: the control
 * plane database plus project data and managed Postgres volumes. Each part
 * degrades to 0 on failure so the heartbeat itself never breaks.
 */
export async function getBackupBytes(exec: ExecFn = defaultExec): Promise<number> {
	const [database, volumes] = await Promise.all([
		getDatabaseBytes().catch(() => 0),
		getVolumeBytes(exec).catch(() => 0)
	]);
	return database + volumes;
}
