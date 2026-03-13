<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let hostname = $state(data.hostname ?? '');
	let timezone = $state(data.timezone ?? 'UTC');
	let email = $state(data.user?.email ?? '');
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let generalSaving = $state(false);
	let emailSaving = $state(false);
	let passwordSaving = $state(false);
	let generatingToken = $state(false);
	let revokingToken = $state(false);
	let tokenCopied = $state(false);
	let newlyGeneratedToken = $state<string | null>(null);
	let retentionDays = $state(data.retentionDays ?? 30);
	let retentionSaving = $state(false);

	/* Docker disk usage state */
	interface DiskEntry {
		count: number;
		sizeFormatted: string;
	}
	interface DockerDisk {
		images: DiskEntry;
		containers: DiskEntry;
		volumes: DiskEntry;
		buildCache: { sizeFormatted: string };
		totalFormatted: string;
	}
	let diskUsage = $state<DockerDisk | null>(null);
	let diskLoading = $state(false);
	let pruning = $state<string | null>(null);
	let pruneResult = $state<string | null>(null);
	let cleanupRunning = $state(false);
	let cleanupResult = $state<string | null>(null);

	/* Passkey state */
	interface PasskeyEntry {
		id: string;
		name: string | null;
		createdAt: string | number | null;
	}
	let passkeys = $state<PasskeyEntry[]>([]);
	let passkeysLoading = $state(false);
	let passkeyRegistering = $state(false);
	let passkeyError = $state<string | null>(null);
	let passkeySuccess = $state<string | null>(null);
	let passkeyName = $state('');

	async function loadPasskeys() {
		passkeysLoading = true;
		try {
			const { data: list } = await authClient.passkey.listUserPasskeys();
			passkeys = (list ?? []) as PasskeyEntry[];
		} finally {
			passkeysLoading = false;
		}
	}

	async function registerPasskey() {
		passkeyRegistering = true;
		passkeyError = null;
		passkeySuccess = null;
		try {
			const { error } = await authClient.passkey.addPasskey({
				name: passkeyName || undefined
			});
			if (error) {
				passkeyError = error.message || 'Failed to register passkey';
			} else {
				passkeySuccess = 'Passkey registered';
				passkeyName = '';
				await loadPasskeys();
			}
		} catch {
			passkeyError = 'Browser does not support passkeys or registration was cancelled';
		} finally {
			passkeyRegistering = false;
		}
	}

	async function deletePasskey(id: string) {
		const { error } = await authClient.passkey.deletePasskey({ id });
		if (!error) {
			await loadPasskeys();
		}
	}

	async function loadDiskUsage() {
		diskLoading = true;
		try {
			const res = await fetch(resolve('/api/cleanup'));
			if (res.ok) {
				const d = await res.json();
				diskUsage = d.diskUsage;
			}
		} finally {
			diskLoading = false;
		}
	}

	async function runPrune(type: string) {
		pruning = type;
		pruneResult = null;
		try {
			const res = await fetch(resolve('/api/cleanup'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'dockerPrune', type })
			});
			if (res.ok) {
				const d = await res.json();
				pruneResult = `Reclaimed: ${d.result.spaceReclaimed}`;
				await loadDiskUsage();
			}
		} finally {
			pruning = null;
		}
	}

	async function runCleanupNow() {
		cleanupRunning = true;
		cleanupResult = null;
		try {
			const res = await fetch(resolve('/api/cleanup'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'runCleanup' })
			});
			if (res.ok) {
				const d = await res.json();
				cleanupResult = `Removed ${d.result.deploymentsRemoved} deployments, ${d.result.buildLogsRemoved} logs`;
			}
		} finally {
			cleanupRunning = false;
		}
	}

	const timezones = [
		'UTC',
		'America/New_York',
		'America/Chicago',
		'America/Denver',
		'America/Los_Angeles',
		'Europe/London',
		'Europe/Berlin',
		'Europe/Paris',
		'Asia/Tokyo',
		'Asia/Shanghai',
		'Asia/Kolkata',
		'Australia/Sydney',
		'Pacific/Auckland'
	];

	function copyToken() {
		if (newlyGeneratedToken) {
			navigator.clipboard.writeText(newlyGeneratedToken);
			tokenCopied = true;
			setTimeout(() => (tokenCopied = false), 2000);
		}
	}
</script>

<svelte:head>
	<title>Settings — Risved</title>
</svelte:head>

<div class="settings-page">
	<header class="page-header">
		<a href={resolve('/')} class="back-link">← Dashboard</a>
		<h1>Settings</h1>
	</header>

	<!-- Navigation -->
	<nav class="settings-nav" data-testid="settings-nav">
		<a href={resolve('/settings/providers')} class="nav-link" data-testid="providers-link">
			Git Providers
		</a>
		<a href={resolve('/settings/git')} class="nav-link" data-testid="git-settings-link">
			Git Settings
		</a>
	</nav>

	<!-- General Settings -->
	<section class="section" data-testid="general-section">
		<h2 class="section-title">General</h2>
		<form
			method="post"
			action="?/general"
			use:enhance={() => {
				generalSaving = true;
				return async ({ update }) => {
					generalSaving = false;
					await update();
				};
			}}
		>
			<div class="form-card">
				<div class="form-group">
					<label for="hostname" class="form-label">Hostname</label>
					<input
						type="text"
						id="hostname"
						name="hostname"
						bind:value={hostname}
						placeholder="risved.example.com"
						class="form-input mono"
						data-testid="hostname-input"
					/>
					<p class="form-hint">The public hostname where Risved is accessible.</p>
				</div>

				<div class="form-group">
					<label for="timezone" class="form-label">Timezone</label>
					<select
						id="timezone"
						name="timezone"
						bind:value={timezone}
						class="form-input"
						data-testid="timezone-select"
					>
						{#each timezones as tz (tz)}
							<option value={tz}>{tz}</option>
						{/each}
					</select>
				</div>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={generalSaving}
						data-testid="save-general-btn"
					>
						{generalSaving ? 'Saving…' : 'Save changes'}
					</button>
					{#if form?.generalSaved}
						<span class="save-success" data-testid="general-saved">Saved</span>
					{/if}
				</div>
			</div>
		</form>
	</section>

	<!-- Admin Email -->
	<section class="section" data-testid="email-section">
		<h2 class="section-title">Admin Email</h2>
		<form
			method="post"
			action="?/email"
			use:enhance={() => {
				emailSaving = true;
				return async ({ update }) => {
					emailSaving = false;
					await update();
				};
			}}
		>
			<div class="form-card">
				<div class="form-group">
					<label for="email" class="form-label">Email address</label>
					<input
						type="email"
						id="email"
						name="email"
						bind:value={email}
						class="form-input mono"
						data-testid="email-input"
					/>
				</div>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={emailSaving}
						data-testid="save-email-btn"
					>
						{emailSaving ? 'Saving…' : 'Update email'}
					</button>
					{#if form?.emailSaved}
						<span class="save-success" data-testid="email-saved">Updated</span>
					{/if}
					{#if form?.emailError}
						<span class="form-error" data-testid="email-error">{form.emailError}</span>
					{/if}
				</div>
			</div>
		</form>
	</section>

	<!-- Change Password -->
	<section class="section" data-testid="password-section">
		<h2 class="section-title">Change Password</h2>
		<form
			method="post"
			action="?/password"
			use:enhance={() => {
				passwordSaving = true;
				return async ({ update }) => {
					passwordSaving = false;
					currentPassword = '';
					newPassword = '';
					confirmPassword = '';
					await update();
				};
			}}
		>
			<div class="form-card">
				<div class="form-group">
					<label for="currentPassword" class="form-label">Current password</label>
					<input
						type="password"
						id="currentPassword"
						name="currentPassword"
						bind:value={currentPassword}
						class="form-input"
						data-testid="current-password-input"
					/>
				</div>

				<div class="form-group">
					<label for="newPassword" class="form-label">New password</label>
					<input
						type="password"
						id="newPassword"
						name="newPassword"
						bind:value={newPassword}
						class="form-input"
						data-testid="new-password-input"
					/>
					<p class="form-hint">Minimum 12 characters.</p>
				</div>

				<div class="form-group">
					<label for="confirmPassword" class="form-label">Confirm new password</label>
					<input
						type="password"
						id="confirmPassword"
						name="confirmPassword"
						bind:value={confirmPassword}
						class="form-input"
						data-testid="confirm-password-input"
					/>
				</div>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
						data-testid="change-password-btn"
					>
						{passwordSaving ? 'Changing…' : 'Change password'}
					</button>
					{#if form?.passwordChanged}
						<span class="save-success" data-testid="password-changed">Password changed</span>
					{/if}
					{#if form?.passwordError}
						<span class="form-error" data-testid="password-error">{form.passwordError}</span>
					{/if}
				</div>
			</div>
		</form>
	</section>

	<!-- Passkeys -->
	<section class="section" data-testid="passkey-section">
		<h2 class="section-title">Passkeys</h2>
		<div class="form-card">
			{#if passkeys.length > 0}
				<div class="passkey-list" data-testid="passkey-list">
					{#each passkeys as pk (pk.id)}
						<div class="passkey-item">
							<div class="passkey-info">
								<span class="passkey-name">{pk.name || 'Unnamed passkey'}</span>
								<span class="passkey-date mono">
									{pk.createdAt ? new Date(pk.createdAt).toLocaleDateString() : ''}
								</span>
							</div>
							<button
								class="btn-danger-sm"
								onclick={() => deletePasskey(pk.id)}
								data-testid="delete-passkey-btn"
							>
								Remove
							</button>
						</div>
					{/each}
				</div>
			{:else if !passkeysLoading}
				<p class="empty-text" data-testid="no-passkeys">No passkeys registered.</p>
			{/if}

			<div class="passkey-register">
				<div class="form-group">
					<label for="passkeyName" class="form-label">Passkey name (optional)</label>
					<input
						type="text"
						id="passkeyName"
						bind:value={passkeyName}
						placeholder="e.g. MacBook fingerprint"
						class="form-input"
						data-testid="passkey-name-input"
					/>
				</div>
				<div class="form-actions">
					<button
						class="btn-primary"
						disabled={passkeyRegistering}
						onclick={registerPasskey}
						data-testid="register-passkey-btn"
					>
						{passkeyRegistering ? 'Registering…' : 'Register passkey'}
					</button>
					<button
						class="btn-secondary"
						disabled={passkeysLoading}
						onclick={loadPasskeys}
						data-testid="refresh-passkeys-btn"
					>
						{passkeysLoading ? 'Loading…' : 'Refresh'}
					</button>
					{#if passkeySuccess}
						<span class="save-success" data-testid="passkey-success">{passkeySuccess}</span>
					{/if}
					{#if passkeyError}
						<span class="form-error" data-testid="passkey-error">{passkeyError}</span>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<!-- API Token -->
	<section class="section" data-testid="token-section">
		<h2 class="section-title">API Token</h2>
		<div class="form-card">
			{#if newlyGeneratedToken}
				<div class="token-display" data-testid="new-token-display">
					<p class="token-warning">Copy this token now — it won't be shown again.</p>
					<div class="token-row">
						<code class="token-value mono" data-testid="token-value">{newlyGeneratedToken}</code>
						<button class="btn-copy" onclick={copyToken} data-testid="copy-token-btn">
							{tokenCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
				</div>
			{:else if data.apiToken}
				<div class="token-existing" data-testid="existing-token">
					<span class="form-label">Current token</span>
					<code class="token-masked mono" data-testid="masked-token">{data.apiToken}</code>
				</div>
			{:else}
				<p class="empty-text" data-testid="no-token">No API token generated.</p>
			{/if}

			<div class="token-actions">
				<form
					method="post"
					action="?/generateToken"
					use:enhance={() => {
						generatingToken = true;
						return async ({ update, result }) => {
							generatingToken = false;
							if (result.type === 'success' && result.data?.newToken) {
								newlyGeneratedToken = result.data.newToken as string;
							}
							await update({ reset: false });
						};
					}}
				>
					<button
						type="submit"
						class="btn-secondary"
						disabled={generatingToken}
						data-testid="generate-token-btn"
					>
						{generatingToken
							? 'Generating…'
							: data.apiToken
								? 'Regenerate token'
								: 'Generate token'}
					</button>
				</form>

				{#if data.apiToken || newlyGeneratedToken}
					<form
						method="post"
						action="?/revokeToken"
						use:enhance={() => {
							revokingToken = true;
							return async ({ update }) => {
								revokingToken = false;
								newlyGeneratedToken = null;
								await update();
							};
						}}
					>
						<button
							type="submit"
							class="btn-danger-sm"
							disabled={revokingToken}
							data-testid="revoke-token-btn"
						>
							{revokingToken ? 'Revoking…' : 'Revoke token'}
						</button>
					</form>
				{/if}
			</div>
		</div>
	</section>

	<!-- Build Log Retention -->
	<section class="section" data-testid="retention-section">
		<h2 class="section-title">Build Log Retention</h2>
		<form
			method="post"
			action="?/retention"
			use:enhance={() => {
				retentionSaving = true;
				return async ({ update }) => {
					retentionSaving = false;
					await update();
				};
			}}
		>
			<div class="form-card">
				<div class="form-group">
					<label for="retentionDays" class="form-label">Retention period (days)</label>
					<input
						type="number"
						id="retentionDays"
						name="retentionDays"
						bind:value={retentionDays}
						min="1"
						max="365"
						class="form-input"
						style="max-width: 120px;"
						data-testid="retention-input"
					/>
					<p class="form-hint">
						Deployments and build logs older than this will be automatically cleaned up.
					</p>
				</div>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={retentionSaving}
						data-testid="save-retention-btn"
					>
						{retentionSaving ? 'Saving…' : 'Save'}
					</button>
					<button
						type="button"
						class="btn-secondary"
						disabled={cleanupRunning}
						onclick={runCleanupNow}
						data-testid="run-cleanup-btn"
					>
						{cleanupRunning ? 'Running…' : 'Run cleanup now'}
					</button>
					{#if form?.retentionSaved}
						<span class="save-success" data-testid="retention-saved">Saved</span>
					{/if}
					{#if form?.retentionError}
						<span class="form-error" data-testid="retention-error">{form.retentionError}</span>
					{/if}
					{#if cleanupResult}
						<span class="save-success" data-testid="cleanup-result">{cleanupResult}</span>
					{/if}
				</div>
			</div>
		</form>
	</section>

	<!-- Docker Disk Usage -->
	<section class="section" data-testid="docker-section">
		<h2 class="section-title">Docker Resources</h2>
		<div class="form-card">
			{#if diskUsage}
				<div class="disk-grid" data-testid="disk-usage">
					<div class="disk-row">
						<span class="disk-label">Images</span>
						<span class="disk-count mono">{diskUsage.images.count}</span>
						<span class="disk-size mono">{diskUsage.images.sizeFormatted}</span>
					</div>
					<div class="disk-row">
						<span class="disk-label">Containers</span>
						<span class="disk-count mono">{diskUsage.containers.count}</span>
						<span class="disk-size mono">{diskUsage.containers.sizeFormatted}</span>
					</div>
					<div class="disk-row">
						<span class="disk-label">Volumes</span>
						<span class="disk-count mono">{diskUsage.volumes.count}</span>
						<span class="disk-size mono">{diskUsage.volumes.sizeFormatted}</span>
					</div>
					<div class="disk-row">
						<span class="disk-label">Build Cache</span>
						<span class="disk-count mono">—</span>
						<span class="disk-size mono">{diskUsage.buildCache.sizeFormatted}</span>
					</div>
					<div class="disk-row disk-total">
						<span class="disk-label">Total</span>
						<span class="disk-count mono"></span>
						<span class="disk-size mono">{diskUsage.totalFormatted}</span>
					</div>
				</div>
			{:else}
				<p class="empty-text">
					{diskLoading
						? 'Loading Docker disk usage…'
						: 'Click "Load usage" to view Docker disk usage.'}
				</p>
			{/if}

			<div class="docker-actions">
				<button
					class="btn-secondary"
					disabled={diskLoading}
					onclick={loadDiskUsage}
					data-testid="load-disk-btn"
				>
					{diskLoading ? 'Loading…' : 'Load usage'}
				</button>
				<button
					class="btn-secondary"
					disabled={pruning !== null}
					onclick={() => runPrune('images')}
					data-testid="prune-images-btn"
				>
					{pruning === 'images' ? 'Pruning…' : 'Prune images'}
				</button>
				<button
					class="btn-secondary"
					disabled={pruning !== null}
					onclick={() => runPrune('containers')}
					data-testid="prune-containers-btn"
				>
					{pruning === 'containers' ? 'Pruning…' : 'Prune containers'}
				</button>
				<button
					class="btn-secondary"
					disabled={pruning !== null}
					onclick={() => runPrune('volumes')}
					data-testid="prune-volumes-btn"
				>
					{pruning === 'volumes' ? 'Pruning…' : 'Prune volumes'}
				</button>
				<button
					class="btn-danger-sm"
					disabled={pruning !== null}
					onclick={() => runPrune('all')}
					data-testid="prune-all-btn"
				>
					{pruning === 'all' ? 'Pruning…' : 'Prune all'}
				</button>
			</div>

			{#if pruneResult}
				<span class="save-success" data-testid="prune-result">{pruneResult}</span>
			{/if}
		</div>
	</section>
</div>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-8);
		max-width: 640px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-6);
	}

	.back-link {
		font-size: 0.8125rem;
		color: var(--color-text-2);
		display: inline-block;
		margin-bottom: var(--space-2);
	}
	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 600;
	}

	/* Settings nav */
	.settings-nav {
		display: flex;
		gap: var(--space-2);
	}
	.nav-link {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.8125rem;
		font-weight: 500;
		text-decoration: none;
	}
	.nav-link:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	/* Sections */
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.section-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* Form card */
	.form-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.form-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-1);
	}
	.form-input {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 0.8125rem;
	}
	.form-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.form-hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
		margin-top: 2px;
	}

	.form-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	/* Buttons */
	.btn-primary {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-primary:hover {
		opacity: 0.9;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-secondary:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-danger-sm {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-failed);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.btn-danger-sm:hover {
		background: rgba(239, 68, 68, 0.1);
	}
	.btn-danger-sm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-copy {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: 0.75rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Feedback */
	.save-success {
		font-size: 0.8125rem;
		color: var(--color-live);
	}
	.form-error {
		font-size: 0.8125rem;
		color: var(--color-failed);
	}
	.empty-text {
		color: var(--color-text-2);
		font-size: 0.85rem;
	}

	/* Token display */
	.token-display {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.token-warning {
		font-size: 0.8125rem;
		color: var(--color-building);
		font-weight: 500;
	}
	.token-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.token-value {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		word-break: break-all;
		color: var(--color-text-0);
	}
	.token-existing {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.token-masked {
		color: var(--color-text-2);
	}
	.token-actions {
		display: flex;
		gap: var(--space-2);
	}

	/* Docker disk usage */
	.disk-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.disk-row {
		display: grid;
		grid-template-columns: 1fr 60px 80px;
		align-items: center;
		padding: var(--space-1) 0;
		font-size: 0.8125rem;
	}
	.disk-total {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-2);
		font-weight: 600;
	}
	.disk-label {
		color: var(--color-text-1);
	}
	.disk-count {
		text-align: right;
		color: var(--color-text-2);
	}
	.disk-size {
		text-align: right;
		color: var(--color-text-0);
	}
	.docker-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* Passkey styles */
	.passkey-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.passkey-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
	}
	.passkey-item:last-child {
		border-bottom: none;
	}
	.passkey-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.passkey-name {
		font-size: 0.8125rem;
		color: var(--color-text-0);
		font-weight: 500;
	}
	.passkey-date {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}
	.passkey-register {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
