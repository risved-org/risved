<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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
</style>
