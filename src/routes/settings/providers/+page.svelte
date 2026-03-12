<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let showForgejoForm = $state(false);
	let forgejoUrl = $state('');
	let forgejoToken = $state('');
	let connectingForgejo = $state(false);
	let disconnecting = $state<string | null>(null);

	const providerLabel: Record<string, string> = {
		github: 'GitHub',
		gitlab: 'GitLab',
		forgejo: 'Forgejo / Gitea'
	};

	const providerIcon: Record<string, string> = {
		github: 'GH',
		gitlab: 'GL',
		forgejo: 'FG'
	};

	const githubConnections = $derived(data.connections.filter((c) => c.provider === 'github'));
	const gitlabConnections = $derived(data.connections.filter((c) => c.provider === 'gitlab'));
	const forgejoConnections = $derived(data.connections.filter((c) => c.provider === 'forgejo'));
</script>

<svelte:head>
	<title>Git Providers — Risved</title>
</svelte:head>

<div class="providers-page">
	<header class="page-header">
		<a href={resolve('/settings')} class="back-link">← Settings</a>
		<h1>Git Providers</h1>
		<p class="page-desc">
			Connect your Git accounts to import repositories and auto-configure webhooks.
		</p>
	</header>

	<!-- Provider Cards -->
	<section class="section" data-testid="provider-cards">
		<h2 class="section-title">Connect a Provider</h2>
		<div class="cards-grid">
			<!-- GitHub -->
			<div class="provider-card" data-testid="github-card">
				<div class="card-header">
					<span class="provider-icon github">{providerIcon.github}</span>
					<div>
						<h3 class="card-name">GitHub</h3>
						<p class="card-desc">OAuth · github.com</p>
					</div>
				</div>
				<a
					href={resolve('/api/git/github?action=connect')}
					class="btn-connect"
					data-testid="github-connect-btn"
				>
					{githubConnections.length > 0 ? 'Reconnect' : 'Connect'}
				</a>
			</div>

			<!-- GitLab -->
			<div class="provider-card" data-testid="gitlab-card">
				<div class="card-header">
					<span class="provider-icon gitlab">{providerIcon.gitlab}</span>
					<div>
						<h3 class="card-name">GitLab</h3>
						<p class="card-desc">OAuth · cloud or self-hosted</p>
					</div>
				</div>
				<a
					href={resolve('/api/git/gitlab?action=connect')}
					class="btn-connect"
					data-testid="gitlab-connect-btn"
				>
					{gitlabConnections.length > 0 ? 'Reconnect' : 'Connect'}
				</a>
			</div>

			<!-- Forgejo / Gitea -->
			<div class="provider-card" data-testid="forgejo-card">
				<div class="card-header">
					<span class="provider-icon forgejo">{providerIcon.forgejo}</span>
					<div>
						<h3 class="card-name">Forgejo / Gitea</h3>
						<p class="card-desc">API token · self-hosted · Codeberg</p>
					</div>
				</div>
				<button
					class="btn-connect"
					onclick={() => (showForgejoForm = !showForgejoForm)}
					data-testid="forgejo-connect-btn"
				>
					{forgejoConnections.length > 0 ? 'Add another' : 'Connect'}
				</button>
			</div>

			<!-- Other / Manual -->
			<div class="provider-card other" data-testid="other-card">
				<div class="card-header">
					<span class="provider-icon other">?</span>
					<div>
						<h3 class="card-name">Other Provider</h3>
						<p class="card-desc">Use manual webhooks (Phase 1 setup)</p>
					</div>
				</div>
				<a href={resolve('/new')} class="btn-connect btn-muted" data-testid="other-connect-btn">
					Manual setup
				</a>
			</div>
		</div>
	</section>

	<!-- Forgejo Connect Form -->
	{#if showForgejoForm}
		<section class="section" data-testid="forgejo-form">
			<h2 class="section-title">Connect Forgejo / Gitea</h2>
			<form
				method="post"
				action="?/forgejo"
				use:enhance={() => {
					connectingForgejo = true;
					return async ({ update, result }) => {
						connectingForgejo = false;
						if (result.type === 'success') {
							showForgejoForm = false;
							forgejoUrl = '';
							forgejoToken = '';
						}
						await update();
					};
				}}
			>
				<div class="form-card">
					<div class="form-group">
						<label for="instanceUrl" class="form-label">Instance URL</label>
						<input
							type="url"
							id="instanceUrl"
							name="instanceUrl"
							bind:value={forgejoUrl}
							placeholder="https://codeberg.org"
							class="form-input mono"
							data-testid="forgejo-url-input"
						/>
						<p class="form-hint">Your Forgejo, Gitea, or Codeberg instance URL.</p>
					</div>

					<div class="form-group">
						<label for="token" class="form-label">API Token</label>
						<input
							type="password"
							id="token"
							name="token"
							bind:value={forgejoToken}
							placeholder="your-api-token"
							class="form-input mono"
							data-testid="forgejo-token-input"
						/>
						<p class="form-hint">Generate at Settings → Applications on your instance.</p>
					</div>

					<div class="form-actions">
						<button
							type="submit"
							class="btn-primary"
							disabled={connectingForgejo || !forgejoUrl || !forgejoToken}
							data-testid="forgejo-submit-btn"
						>
							{connectingForgejo ? 'Connecting…' : 'Connect'}
						</button>
						<button type="button" class="btn-secondary" onclick={() => (showForgejoForm = false)}>
							Cancel
						</button>
						{#if form?.forgejoConnected}
							<span class="save-success">Connected as {form.accountName}</span>
						{/if}
						{#if form?.forgejoError}
							<span class="form-error" data-testid="forgejo-error">{form.forgejoError}</span>
						{/if}
					</div>
				</div>
			</form>
		</section>
	{/if}

	<!-- Connected Accounts -->
	<section class="section" data-testid="connected-accounts">
		<h2 class="section-title">Connected Accounts</h2>
		{#if data.connections.length === 0}
			<p class="empty-text" data-testid="no-connections">No Git providers connected yet.</p>
		{:else}
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
							<span class="account-name">{conn.accountName}</span>
							<span class="account-provider">{providerLabel[conn.provider] ?? conn.provider}</span>
						</div>
						<form
							method="post"
							action="?/disconnect"
							use:enhance={() => {
								disconnecting = conn.id;
								return async ({ update }) => {
									disconnecting = null;
									await update();
								};
							}}
						>
							<input type="hidden" name="connectionId" value={conn.id} />
							<button
								type="submit"
								class="btn-disconnect"
								disabled={disconnecting === conn.id}
								data-testid="disconnect-btn"
							>
								{disconnecting === conn.id ? 'Removing…' : 'Disconnect'}
							</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.providers-page {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-8);
		max-width: 720px;
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
	.page-desc {
		color: var(--color-text-2);
		font-size: 0.85rem;
		margin-top: var(--space-1);
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

	/* Provider cards grid */
	.cards-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}

	.provider-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.card-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.card-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-0);
	}
	.card-desc {
		font-size: 0.75rem;
		color: var(--color-text-2);
		margin-top: 2px;
	}

	.provider-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.provider-icon.github {
		background: #24292e;
		color: #fff;
	}
	.provider-icon.gitlab {
		background: #fc6d26;
		color: #fff;
	}
	.provider-icon.forgejo {
		background: #609926;
		color: #fff;
	}
	.provider-icon.other {
		background: var(--color-bg-2, #333);
		color: var(--color-text-2);
	}
	.provider-icon.sm {
		width: 28px;
		height: 28px;
		font-size: 0.65rem;
	}

	.btn-connect {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		text-align: center;
	}
	.btn-connect:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-muted {
		color: var(--color-text-2);
	}

	/* Form elements (same as settings) */
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
		cursor: pointer;
	}
	.btn-secondary:hover {
		border-color: var(--color-text-2);
	}

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
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.account-provider {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}
	.btn-disconnect {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-failed);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-disconnect:hover {
		background: rgba(239, 68, 68, 0.1);
	}
	.btn-disconnect:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
