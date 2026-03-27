<script lang="ts">
	import { enhance } from '$app/forms'
	import { resolve } from '$app/paths'
	import type { PageData, ActionData } from './$types'
	import GitProviderCards from '$lib/components/GitProviderCards.svelte'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let showCards = $state(false)
	let disconnecting = $state<string | null>(null)
	let refreshing = $state<string | null>(null)
	let generatingKey = $state(false)
	let revokingKey = $state(false)
	let savingDefaults = $state(false)
	let keyCopied = $state(false)
	let showKeyGenerated = $state(false)
	let showDefaultsSaved = $state(false)
	let autoWebhook = $state(data.defaults.autoWebhook)
	let commitStatus = $state(data.defaults.commitStatus)
	let deployPreviews = $state(data.defaults.deployPreviews)

	$effect(() => {
		if (form?.keyGenerated) {
			showKeyGenerated = true
			setTimeout(() => { showKeyGenerated = false }, 3000)
		}
	})

	$effect(() => {
		if (form?.defaultsSaved) {
			showDefaultsSaved = true
			setTimeout(() => { showDefaultsSaved = false }, 3000)
		}
	})

	const providerLabel: Record<string, string> = {
		github: 'GitHub',
		gitlab: 'GitLab',
		forgejo: 'Forgejo / Gitea'
	}

	const providerIcon: Record<string, string> = {
		github: 'GH',
		gitlab: 'GL',
		forgejo: 'FG'
	}

	const hasConnections = $derived(data.connections.length > 0)

	function copyKey() {
		if (data.sshPublicKey) {
			navigator.clipboard.writeText(data.sshPublicKey)
			keyCopied = true
			setTimeout(() => (keyCopied = false), 2000)
		}
	}
</script>

<svelte:head>
	<title>Git settings – Risved</title>
</svelte:head>

<article class="git-settings-page">
	<header class="page-header">
		<a href={resolve('/settings')} class="back-link">← Settings</a>
		<h1>Git settings</h1>
		<p class="subtitle">Manage connected accounts, deploy keys, and default webhook behavior.</p>
	</header>

	<section class="section" data-testid="git-provider">
		<h2 class="section-title">Git provider</h2>

		{#if !hasConnections || showCards}
			<GitProviderCards
				connections={data.connections}
				isCloud={data.isCloud}
				{form}
				connectRedirect=""
			/>
		{/if}

		{#if hasConnections}
			<div class="accounts-list">
				{#each data.connections as conn (conn.id)}
					<div class="account-row" data-testid="account-row">
						{#if conn.avatarUrl}
							<img src={conn.avatarUrl} alt="" class="account-avatar" />
						{:else}
							<span class="provider-icon {conn.provider} sm"
								>{providerIcon[conn.provider] ?? '?'}</span
							>
						{/if}
						<div class="account-info">
							<span class="account-name" data-testid="account-name">{conn.accountName}</span>
							<span class="account-provider">{providerLabel[conn.provider] ?? conn.provider}</span>
						</div>
						<div class="account-actions">
							<form
								method="post"
								action="?/refresh"
								use:enhance={() => {
									refreshing = conn.id
									return async ({ update }) => {
										refreshing = null
										await update()
									}
								}}
							>
								<input type="hidden" name="connectionId" value={conn.id} />
								<button
									type="submit"
									class="btn-secondary btn-sm"
									disabled={refreshing === conn.id}
									data-testid="refresh-btn"
								>
									{refreshing === conn.id ? 'Refreshing…' : 'Refresh'}
								</button>
							</form>
							<form
								method="post"
								action="?/disconnect"
								use:enhance={() => {
									disconnecting = conn.id
									return async ({ update }) => {
										disconnecting = null
										await update()
									}
								}}
							>
								<input type="hidden" name="connectionId" value={conn.id} />
								<button
									type="submit"
									class="btn-danger-sm"
									disabled={disconnecting === conn.id}
									data-testid="disconnect-btn"
								>
									{disconnecting === conn.id ? 'Removing…' : 'Disconnect'}
								</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
			{#if !showCards}
				<button
					class="btn-secondary"
					onclick={() => (showCards = true)}
					data-testid="add-another-btn"
				>
					Add another
				</button>
			{/if}
		{/if}
	</section>

	<!-- SSH deploy key -->
	<section class="section" data-testid="ssh-section">
		<h2 class="section-title">SSH deploy key</h2>
		<div class="form-card">
			<p class="form-hint-block">
				Add a read-only public key to your repositories for private repo access via SSH.
			</p>
			{#if data.sshPublicKey}
				<div class="key-display" data-testid="ssh-key-display">
					<code class="key-value mono" data-testid="ssh-key-value">{data.sshPublicKey}</code>
					<button class="btn-copy" onclick={copyKey} data-testid="copy-key-btn">
						{keyCopied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			{/if}
			<div class="key-actions">
				<form
					method="post"
					action="?/generateSshKey"
					use:enhance={() => {
						generatingKey = true
						return async ({ update }) => {
							generatingKey = false
							await update()
						}
					}}
				>
					<button
						type="submit"
						class="btn-secondary"
						disabled={generatingKey}
						data-testid="generate-key-btn"
					>
						{generatingKey
							? 'Generating…'
							: data.sshPublicKey
								? 'Regenerate key'
								: 'Generate deploy key'}
					</button>
				</form>

				{#if data.sshPublicKey}
					<form
						method="post"
						action="?/revokeSshKey"
						use:enhance={() => {
							revokingKey = true
							return async ({ update }) => {
								revokingKey = false
								await update()
							}
						}}
					>
						<button
							type="submit"
							class="btn-danger-sm"
							disabled={revokingKey}
							data-testid="revoke-key-btn"
						>
							{revokingKey ? 'Revoking…' : 'Revoke key'}
						</button>
					</form>
				{/if}
				{#if showKeyGenerated}
					<span class="save-success" data-testid="key-generated">Key generated</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- Default webhook settings -->
	<section class="section" data-testid="defaults-section">
		<h2 class="section-title">Default webhook settings</h2>
		<form
			method="post"
			action="?/saveDefaults"
			use:enhance={() => {
				savingDefaults = true
				return async ({ update }) => {
					savingDefaults = false
					await update({ reset: false })
				}
			}}
		>
			<div class="form-card">
				<label class="toggle-row" data-testid="auto-webhook-toggle">
					<input
						type="checkbox"
						name="autoWebhook"
						bind:checked={autoWebhook}
						class="toggle-input"
					/>
					<div class="toggle-text">
						<span class="toggle-label">Auto-configure webhook on import</span>
						<span class="toggle-hint"
							>Automatically set up webhooks when importing from a connected provider.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="commit-status-toggle">
					<input
						type="checkbox"
						name="commitStatus"
						bind:checked={commitStatus}
						class="toggle-input"
					/>
					<div class="toggle-text">
						<span class="toggle-label">Post commit status</span>
						<span class="toggle-hint"
							>Report build status back to the Git provider as commit checks.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="deploy-previews-toggle">
					<input
						type="checkbox"
						name="deployPreviews"
						bind:checked={deployPreviews}
						class="toggle-input"
					/>
					<div class="toggle-text">
						<span class="toggle-label">Enable deploy previews</span>
						<span class="toggle-hint"
							>Create preview deployments for pull/merge requests by default.</span
						>
					</div>
				</label>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={savingDefaults}
						data-testid="save-defaults-btn"
					>
						{savingDefaults ? 'Saving…' : 'Save defaults'}
					</button>
					{#if showDefaultsSaved}
						<span class="save-success" data-testid="defaults-saved">Saved</span>
					{/if}
				</div>
			</div>
		</form>
	</section>
</article>

<style>
	.git-settings-page {
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

	/* Connected accounts */
	.accounts-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.account-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.account-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
	}
	.account-info {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.account-name {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.account-provider {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.account-actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	/* SSH key display */
	.form-hint-block {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.key-display {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.key-value {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		word-break: break-all;
		color: var(--color-text-0);
		line-height: 1.5;
	}

	.key-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* Toggle rows */
	.toggle-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		cursor: pointer;
		padding: var(--space-2) 0;
	}
	.toggle-input {
		margin-top: 2px;
		flex-shrink: 0;
		appearance: none;
		width: 16px;
		height: 16px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-2);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.toggle-input:checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: center;
	}
	.toggle-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toggle-label {
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-text-1);
	}
	.toggle-hint {
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.btn-sm {
		padding: var(--space-1) var(--space-3);
		font-size: .875rem;
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
		margin-top: var(--space-2);
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
</style>
