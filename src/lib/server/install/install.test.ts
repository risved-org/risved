import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const SCRIPT_PATH = resolve(import.meta.dirname, '../../../../scripts/install.sh');
const script = readFileSync(SCRIPT_PATH, 'utf-8');

/**
 * Run a bash snippet that sources install.sh in test mode,
 * then executes the provided code. Returns stdout.
 */
function runBash(code: string): { stdout: string; exitCode: number } {
	const fullScript = `
		export RISVED_TESTING=1
		source "${SCRIPT_PATH}"
		${code}
	`;
	try {
		const stdout = execSync(`bash -c '${fullScript.replace(/'/g, "'\\''")}'`, {
			encoding: 'utf-8',
			timeout: 5000,
			env: { ...process.env, RISVED_TESTING: '1' }
		});
		return { stdout: stdout.trim(), exitCode: 0 };
	} catch (e: unknown) {
		const err = e as { stdout?: string; status?: number };
		return {
			stdout: (err.stdout ?? '').trim(),
			exitCode: err.status ?? 1
		};
	}
}

describe('Install Script', () => {
	describe('script structure', () => {
		it('starts with a shebang', () => {
			expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
		});

		it('uses set -euo pipefail', () => {
			expect(script).toContain('set -euo pipefail');
		});

		it('has RISVED_TESTING guard around main', () => {
			expect(script).toContain('RISVED_TESTING');
			expect(script).toContain('main "$@"');
		});

		it('defines all required functions', () => {
			const requiredFunctions = [
				'check_root',
				'detect_os',
				'check_ram',
				'check_disk',
				'check_ports',
				'install_docker',
				'install_bun',
				'setup_network',
				'setup_directories',
				'build_builder_images',
				'setup_builder_cron',
				'start_caddy',
				'start_risved',
				'detect_server_ip',
				'main'
			];
			for (const fn of requiredFunctions) {
				expect(script, `missing function: ${fn}`).toContain(`${fn}()`);
			}
		});
	});

	describe('output helpers', () => {
		it('info() prints with blue marker', () => {
			const { stdout } = runBash('info "test message"');
			expect(stdout).toContain('test message');
		});

		it('ok() prints with green marker', () => {
			const { stdout } = runBash('ok "success message"');
			expect(stdout).toContain('success message');
		});

		it('warn() prints with yellow marker', () => {
			const { stdout } = runBash('warn "warning message"');
			expect(stdout).toContain('warning message');
		});

		it('err() prints to stderr', () => {
			const { exitCode } = runBash('err "error message" 2>/dev/null');
			expect(exitCode).toBe(0);
		});

		it('fatal() exits with code 1', () => {
			const { exitCode } = runBash('fatal "fatal error" 2>/dev/null');
			expect(exitCode).toBe(1);
		});
	});

	describe('banner', () => {
		it('prints the Risved ASCII art', () => {
			const { stdout } = runBash('banner');
			// ASCII art renders "risved" across multiple lines
			expect(stdout).toContain('_____');
			expect(stdout).toContain('Deploy to Risved');
		});
	});

	describe('check_root', () => {
		it('fails when not running as root', () => {
			// In most test environments we are not root
			if (process.getuid?.() === 0) return;
			const { exitCode } = runBash('check_root 2>/dev/null');
			expect(exitCode).toBe(1);
		});
	});

	describe('configuration defaults', () => {
		it('sets default port to 3000', () => {
			const { stdout } = runBash('echo $RISVED_PORT');
			expect(stdout).toBe('3000');
		});

		it('sets Docker network name to risved', () => {
			const { stdout } = runBash('echo $RISVED_DOCKER_NETWORK');
			expect(stdout).toBe('risved');
		});

		it('sets data directory to /opt/risved', () => {
			const { stdout } = runBash('echo $RISVED_DATA_DIR');
			expect(stdout).toBe('/opt/risved');
		});

		it('sets minimum RAM to 2048 MB', () => {
			const { stdout } = runBash('echo $MIN_RAM_MB');
			expect(stdout).toBe('2048');
		});

		it('sets minimum disk to 10240 MB', () => {
			const { stdout } = runBash('echo $MIN_DISK_MB');
			expect(stdout).toBe('10240');
		});

		it('allows overriding RISVED_VERSION via env', () => {
			const fullScript = `
				export RISVED_TESTING=1
				export RISVED_VERSION=1.2.3
				source "${SCRIPT_PATH}"
				echo $RISVED_VERSION
			`;
			const stdout = execSync(`bash -c '${fullScript.replace(/'/g, "'\\''")}'`, {
				encoding: 'utf-8',
				timeout: 5000
			}).trim();
			expect(stdout).toBe('1.2.3');
		});
	});

	describe('idempotency patterns', () => {
		it('install_docker checks for existing docker command', () => {
			expect(script).toContain('command -v docker');
		});

		it('install_bun checks for existing bun command', () => {
			expect(script).toContain('command -v bun');
		});

		it('setup_network checks for existing network', () => {
			expect(script).toContain('docker network inspect');
		});

		it('start_caddy checks for existing container', () => {
			expect(script).toContain('risved-caddy');
		});

		it('start_risved checks for existing container', () => {
			expect(script).toContain('risved-control');
		});

		it('Docker GPG key is only added if not present', () => {
			expect(script).toContain('if [ ! -f /etc/apt/keyrings/docker.gpg ]');
		});

		it('Docker repo is only added if not present', () => {
			expect(script).toContain('if [ ! -f /etc/apt/sources.list.d/docker.list ]');
		});
	});

	describe('security', () => {
		it('does not use snap for Docker', () => {
			expect(script).not.toContain('snap install');
		});

		it('uses official Docker repository', () => {
			expect(script).toContain('download.docker.com');
		});

		it('uses official Bun installer', () => {
			expect(script).toContain('bun.sh/install');
		});

		it('mounts docker socket for control plane', () => {
			expect(script).toContain('/var/run/docker.sock');
		});

		it('uses restart unless-stopped for containers', () => {
			expect(script).toContain('--restart unless-stopped');
		});
	});

	describe('detect_os', () => {
		it('requires /etc/os-release to exist', () => {
			expect(script).toContain('/etc/os-release');
		});

		it('checks for ubuntu or debian', () => {
			expect(script).toContain('ubuntu|debian');
		});
	});

	describe('resource checks', () => {
		it('check_ram reads from /proc/meminfo', () => {
			expect(script).toContain('/proc/meminfo');
		});

		it('check_disk uses df on root partition', () => {
			expect(script).toContain('df --output=avail /');
		});

		it('check_ports uses ss to detect port usage', () => {
			expect(script).toContain('ss -tlnp');
		});
	});

	describe('IP detection', () => {
		it('tries multiple IP detection methods', () => {
			expect(script).toContain('ifconfig.me');
			expect(script).toContain('ipify.org');
			expect(script).toContain('hostname -I');
		});

		it('falls back to placeholder if all methods fail', () => {
			expect(script).toContain('<server-ip>');
		});
	});
});
