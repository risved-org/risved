<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import TimezonePicker from '$lib/components/TimezonePicker.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let hostname = $state(data.hostname ?? '');
	let timezone = $state(
		data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
	);
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

	/* Update state */
	let updateInfo = $state(data.updateInfo);
	let updateChecking = $state(false);
	let updateStep = $state<string | null>(null);
	let updateError = $state<string | null>(null);
	let showReleaseNotes = $state(false);

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

	let showGeneralSaved = $state(false)
	let showEmailSaved = $state(false)
	let showPasswordChanged = $state(false)
	let showRetentionSaved = $state(false)

	$effect(() => {
		if (form?.generalSaved) {
			showGeneralSaved = true
			setTimeout(() => { showGeneralSaved = false }, 3000)
		}
	})
	$effect(() => {
		if (form?.emailSaved) {
			showEmailSaved = true
			setTimeout(() => { showEmailSaved = false }, 3000)
		}
	})
	$effect(() => {
		if (form?.passwordChanged) {
			showPasswordChanged = true
			setTimeout(() => { showPasswordChanged = false }, 3000)
		}
	})
	$effect(() => {
		if (form?.retentionSaved) {
			showRetentionSaved = true
			setTimeout(() => { showRetentionSaved = false }, 3000)
		}
	})

	onMount(() => {
		loadPasskeys()
		loadDiskUsage()
	})

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
				setTimeout(() => { passkeySuccess = null }, 3000);
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
				setTimeout(() => { pruneResult = null }, 3000);
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
				setTimeout(() => { cleanupResult = null }, 3000);
			}
		} finally {
			cleanupRunning = false;
		}
	}

	let showUpToDate = $state(false)

	async function checkForUpdates() {
		updateChecking = true
		updateError = null
		showUpToDate = false
		try {
			const res = await fetch(resolve('/api/system/update/check'), { method: 'POST' })
			if (res.ok) {
				updateInfo = await res.json()
				if (!updateInfo?.updateAvailable) {
					showUpToDate = true
					setTimeout(() => { showUpToDate = false }, 3000)
				}
			} else {
				const body = await res.json().catch(() => ({}))
				updateError = body.error || 'Failed to check for updates'
			}
		} catch {
			updateError = 'Could not reach update server'
		} finally {
			updateChecking = false
		}
	}

	async function triggerUpdate() {
		if (!updateInfo?.updateAvailable || !updateInfo.latestVersion) return
		if (!confirm(`Update Risved to ${updateInfo.latestVersion}? The dashboard will briefly restart.`)) return

		updateStep = 'Checking...'
		updateError = null

		try {
			const res = await fetch(resolve('/api/system/update'), { method: 'POST' })
			const body = await res.json()

			if (!res.ok) {
				updateError = body.error || 'Update failed'
				updateStep = null
				return
			}

			updateStep = 'Updating Risved...'

			/* Poll until the new version responds or timeout */
			const targetVersion = body.targetVersion
			let attempts = 0
			const maxAttempts = 60

			const poll = setInterval(async () => {
				attempts++
				try {
					const checkRes = await fetch(resolve('/api/system/update'))
					if (checkRes.ok) {
						const info = await checkRes.json()
						if (info.currentVersion === targetVersion) {
							clearInterval(poll)
							updateStep = null
							updateInfo = info
							return
						}
					}
				} catch {
					/* Server might be restarting */
				}

				if (attempts >= maxAttempts) {
					clearInterval(poll)
					updateStep = null
					updateError = 'Update timed out. Check the server manually.'
				}
			}, 3000)
		} catch {
			updateError = 'Failed to start update'
			updateStep = null
		}
	}

	function copyToken() {
		if (newlyGeneratedToken) {
			navigator.clipboard.writeText(newlyGeneratedToken);
			tokenCopied = true;
			setTimeout(() => (tokenCopied = false), 2000);
		}
	}
</script>

<svelte:head>
	<title>Settings – Risved</title>
</svelte:head>

<article class="settings-page">
	<header class="page-header">
		<a href={resolve('/')} class="back-link">← Dashboard</a>
		<h1>Settings</h1>
	</header>

	<!-- Git -->
	<section class="section" data-testid="git-section">
		<h2 class="section-title">Git</h2>
		<div class="form-card">
			{#if data.connections && data.connections.length > 0}
				<div class="git-provider-info">
					<span class="form-label">Git provider</span>
					<span class="git-provider-value">
						{#each data.connections as conn, i (conn.id)}
							{#if i > 0}, {/if}
							{conn.accountName}
						{/each}
					</span>
				</div>
			{:else}
				<p class="card-desc">No git providers connected.</p>
			{/if}
			<a href={resolve('/settings/git')} class="btn-secondary" data-testid="git-settings-link">
				Git settings
			</a>
		</div>
	</section>

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
				<label class="form-group">
					<span class="form-label">Hostname</span>
					<input
						type="text"
						name="hostname"
						bind:value={hostname}
						placeholder="risved.example.com"
						class="form-input mono"
						data-testid="hostname-input"
					/>
					<p class="form-hint">The public hostname where Risved is accessible.</p>
				</label>

				<label class="form-group">
					<span class="form-label">Timezone</span>
					<TimezonePicker bind:value={timezone} name="timezone" />
				</label>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={generalSaving}
						data-testid="save-general-btn"
					>
						{generalSaving ? 'Saving…' : 'Save changes'}
					</button>
					{#if showGeneralSaved}
						<span class="save-success" data-testid="general-saved">Saved</span>
					{/if}
				</div>
			</div>
		</form>
	</section>

	<!-- Admin Email -->
	<section class="section" data-testid="email-section">
		<h2 class="section-title">Admin email</h2>
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
				<label class="form-group">
					<span class="form-label">Email address</span>
					<input
						type="email"
						name="email"
						bind:value={email}
						class="form-input mono"
						data-testid="email-input"
					/>
				</label>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={emailSaving}
						data-testid="save-email-btn"
					>
						{emailSaving ? 'Saving…' : 'Update email'}
					</button>
					{#if showEmailSaved}
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
		<h2 class="section-title">Change password</h2>
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
				<label class="form-group">
					<span class="form-label">Current password</span>
					<input
						type="password"
						name="currentPassword"
						bind:value={currentPassword}
						class="form-input"
						data-testid="current-password-input"
					/>
				</label>

				<label class="form-group">
					<span class="form-label">New password</span>
					<input
						type="password"
						name="newPassword"
						bind:value={newPassword}
						class="form-input"
						data-testid="new-password-input"
					/>
					<p class="form-hint">Minimum 8 characters.</p>
				</label>

				<label class="form-group">
					<span class="form-label">Confirm new password</span>
					<input
						type="password"
						name="confirmPassword"
						bind:value={confirmPassword}
						class="form-input"
						data-testid="confirm-password-input"
					/>
				</label>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
						data-testid="change-password-btn"
					>
						{passwordSaving ? 'Changing…' : 'Change password'}
					</button>
					{#if showPasswordChanged}
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
								<span class="passkey-date">
									<TimeAgo value={pk.createdAt} />
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
				<label class="form-group">
					<span class="form-label">Passkey name (optional)</span>
					<input
						type="text"
						bind:value={passkeyName}
						placeholder="e.g. MacBook fingerprint"
						class="form-input"
						data-testid="passkey-name-input"
					/>
				</label>
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
		<h2 class="section-title">API token</h2>
		<div class="form-card">
			{#if newlyGeneratedToken}
				<div class="token-display" data-testid="new-token-display">
					<p class="token-warning">Copy this token now – it won't be shown again.</p>
					<div class="token-row">
						<code class="token-value mono" data-testid="token-value">{newlyGeneratedToken}</code>
						<button class="btn-copy" onclick={copyToken} data-testid="copy-token-btn">
							{tokenCopied ? 'Copied' : 'Copy'}
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
		<h2 class="section-title">Build log retention</h2>
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
				<label class="form-group">
					<span class="form-label">Retention in days</span>
					<input
						type="number"
						name="retentionDays"
						bind:value={retentionDays}
						min="1"
						max="365"
						class="form-input retention-input"
						data-testid="retention-input"
					/>
					<p class="form-hint">
						Deployments and build logs are automatically cleaned up after the retention period.
					</p>
				</label>

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
					{#if showRetentionSaved}
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

	<!-- System Update -->
	<section class="section" data-testid="update-section">
		<h2 class="section-title">System update</h2>
		<div class="form-card">
			<div class="update-version" data-testid="update-version">
				<span class="form-label">Risved</span>
				{#if updateInfo?.updateAvailable && updateInfo.latestVersion}
					<span class="version-info">
						<code class="mono">{updateInfo.currentVersion}</code>
						<span class="version-arrow">&rarr;</span>
						<code class="mono version-new">{updateInfo.latestVersion}</code>
						<span class="update-badge">Update available</span>
					</span>
				{:else}
					<span class="version-info">
						<code class="mono">{updateInfo?.currentVersion ?? '–'}</code>
						{#if showUpToDate}
							<span class="version-ok">Up to date</span>
						{/if}
					</span>
				{/if}
			</div>

			{#if updateInfo?.checkedAt}
				<p class="form-hint">
					Last checked: <TimeAgo value={updateInfo.checkedAt} includeTime />
				</p>
			{/if}

			{#if updateInfo?.updateAvailable && updateInfo.releaseNotes}
				<button
					class="btn-link"
					onclick={() => showReleaseNotes = !showReleaseNotes}
					data-testid="toggle-release-notes"
				>
					{showReleaseNotes ? 'Hide' : 'View'} release notes
				</button>
				{#if showReleaseNotes}
					<div class="release-notes mono" data-testid="release-notes">
						{updateInfo.releaseNotes}
					</div>
				{/if}
			{/if}

			{#if updateStep}
				<div class="update-progress" data-testid="update-progress">
					<span class="update-spinner"></span>
					<span>{updateStep}</span>
				</div>
			{/if}

			<div class="form-actions">
				<button
					class="btn-secondary"
					disabled={updateChecking || !!updateStep}
					onclick={checkForUpdates}
					data-testid="check-updates-btn"
				>
					{updateChecking ? 'Checking...' : 'Check for updates'}
				</button>
				{#if updateInfo?.updateAvailable}
					<button
						class="btn-primary"
						disabled={!!updateStep}
						onclick={triggerUpdate}
						data-testid="update-now-btn"
					>
						Update to {updateInfo.latestVersion}
					</button>
				{/if}
			</div>

			{#if updateError}
				<span class="form-error" role="alert" data-testid="update-error">{updateError}</span>
			{/if}
			{#if updateInfo?.error && !updateError}
				<span class="form-error" role="alert">{updateInfo.error}</span>
			{/if}
		</div>
	</section>

	<!-- Docker Disk Usage -->
	<section class="section" data-testid="docker-section">
		<h2 class="section-title">Docker resources</h2>
		<div class="form-card">
			{#if diskUsage}
				<div class="disk-grid" data-testid="disk-usage">
					<div class="disk-row">
						<span class="disk-label">Images</span>
						<span class="disk-count mono">{diskUsage.images.count}</span>
						<span class="disk-size mono">{diskUsage.images.sizeFormatted}</span>
						<button
							class="btn-prune"
							disabled={pruning !== null}
							onclick={() => runPrune('images')}
							data-testid="prune-images-btn"
						>
							{pruning === 'images' ? 'Pruning…' : 'Prune'}
						</button>
					</div>
					<div class="disk-row">
						<span class="disk-label">Containers</span>
						<span class="disk-count mono">{diskUsage.containers.count}</span>
						<span class="disk-size mono">{diskUsage.containers.sizeFormatted}</span>
						<button
							class="btn-prune"
							disabled={pruning !== null}
							onclick={() => runPrune('containers')}
							data-testid="prune-containers-btn"
						>
							{pruning === 'containers' ? 'Pruning…' : 'Prune'}
						</button>
					</div>
					<div class="disk-row">
						<span class="disk-label">Volumes</span>
						<span class="disk-count mono">{diskUsage.volumes.count}</span>
						<span class="disk-size mono">{diskUsage.volumes.sizeFormatted}</span>
						<button
							class="btn-prune"
							disabled={pruning !== null}
							onclick={() => runPrune('volumes')}
							data-testid="prune-volumes-btn"
						>
							{pruning === 'volumes' ? 'Pruning…' : 'Prune'}
						</button>
					</div>
					<div class="disk-row">
						<span class="disk-label">Build cache</span>
						<span class="disk-count mono">–</span>
						<span class="disk-size mono">{diskUsage.buildCache.sizeFormatted}</span>
						<button
							class="btn-prune"
							disabled={pruning !== null}
							onclick={() => runPrune('buildcache')}
							data-testid="prune-buildcache-btn"
						>
							{pruning === 'buildcache' ? 'Pruning…' : 'Prune'}
						</button>
					</div>
					<div class="disk-row disk-total">
						<span class="disk-label">Total</span>
						<span class="disk-count mono"></span>
						<span class="disk-size mono">{diskUsage.totalFormatted}</span>
						<span></span>
					</div>
				</div>
			{:else}
				<p class="empty-text">
					{diskLoading ? 'Loading Docker disk usage…' : 'No Docker disk data available.'}
				</p>
			{/if}

			<div class="form-actions">
				<button
					class="btn-secondary"
					disabled={pruning !== null}
					onclick={() => runPrune('all')}
					data-testid="prune-all-btn"
				>
					{pruning === 'all' ? 'Pruning…' : 'Prune all'}
				</button>
				{#if pruneResult}
					<span class="save-success" data-testid="prune-result">{pruneResult}</span>
				{/if}
			</div>
		</div>
	</section>
</article>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		margin: var(--space-4) auto var(--space-8);
		max-width: 40rem;
		width: 100%;
		gap: var(--space-5);
	}

	.back-link {
		font-size: .875rem;
		color: var(--color-text-2);
		display: inline-block;
		margin-bottom: var(--space-2);
	}
	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 2rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	.card-desc {
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.git-provider-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.git-provider-value {
		font-size: 1rem;
		color: var(--color-text-0);
	}

	.form-card .btn-secondary {
		align-self: flex-start;
	}

	.form-input {
		background: var(--color-bg-0);
		border-width: 1px;
	}

	.retention-input {
		max-width: 120px;
	}

	.btn-copy {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	.form-error {
		font-size: .875rem;
		color: var(--color-failed);
	}
	/* Token display */
	.token-display {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.token-warning {
		font-size: .875rem;
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
		grid-template-columns: 5fr 1fr 1fr 1fr;
		column-gap: var(--space-3);
		align-items: center;
		padding: var(--space-1) 0;
		font-size: .875rem;
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
	.btn-prune {
		padding: .125rem var(--space-1);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: .75rem;
		cursor: pointer;
		justify-self: end;
	}
	.btn-prune:hover:not(:disabled) {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-prune:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Update styles */
	.update-version {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.version-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 1rem;
	}
	.version-arrow {
		color: var(--color-text-2);
	}
	.version-new {
		color: var(--color-accent);
		font-weight: 500;
	}
	.version-ok {
		color: var(--color-live);
		font-size: 1rem;
	}
	.update-badge {
		padding: 1px var(--space-2);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		color: var(--color-accent);
		font-size: 1rem;
		font-weight: 500;
	}
	.btn-link {
		background: none;
		border: none;
		color: var(--color-accent);
		font-size: 1rem;
		cursor: pointer;
		padding: 0;
		text-align: left;
	}
	.btn-link:hover {
		text-decoration: underline;
	}
	.release-notes {
		padding: var(--space-3);
		background: var(--color-bg-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 1rem;
		line-height: 1.6;
		white-space: pre-wrap;
		max-height: 200px;
		overflow-y: auto;
	}
	.update-progress {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 1rem;
		color: var(--color-building);
	}
	.update-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-building);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
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
		font-size: 1rem;
		color: var(--color-text-0);
		font-weight: 500;
	}
	.passkey-date {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.passkey-register {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
