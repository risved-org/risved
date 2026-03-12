<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let disconnecting = $state<string | null>(null);
	let refreshing = $state<string | null>(null);
	let generatingKey = $state(false);
	let savingDefaults = $state(false);
	let keyCopied = $state(false);

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

	function connectionAge(createdAt: string): string {
		const diff = Date.now() - new Date(createdAt).getTime();
		const days = Math.floor(diff / 86400000);
		if (days < 1) return 'today';
		if (days === 1) return '1 day ago';
		if (days < 30) return `${days} days ago`;
		const months = Math.floor(days / 30);
		if (months === 1) return '1 month ago';
		return `${months} months ago`;
	}

	function copyKey() {
		if (data.sshPublicKey) {
			navigator.clipboard.writeText(data.sshPublicKey);
			keyCopied = true;
			setTimeout(() => (keyCopied = false), 2000);
		}
	}
</script>

<svelte:head>
	<title>Git Settings — Risved</title>
</svelte:head>

<div class="git-settings-page">
	<header class="page-header">
		<a href={resolve('/settings')} class="back-link">← Settings</a>
		<h1>Git Settings</h1>
		<p class="page-desc">Manage connected accounts, deploy keys, and default webhook behavior.</p>
	</header>

	<!-- Connected Accounts -->
	<section class="section" data-testid="accounts-section">
		<h2 class="section-title">Connected Accounts</h2>
		{#if data.connections.length === 0}
			<div class="form-card">
				<p class="empty-text" data-testid="no-connections">
					No Git providers connected.
					<a href={resolve('/settings/providers')} class="inline-link">Connect a provider</a>
				</p>
			</div>
		{:else}
			<div class="accounts-list">
				{#each data.connections as conn (conn.id)}
					<div class="account-row" data-testid="account-row">
						<div class="account-left">
							{#if conn.avatarUrl}
								<img src={conn.avatarUrl} alt="" class="account-avatar" />
							{:else}
								<span class="provider-icon {conn.provider}"
									>{providerIcon[conn.provider] ?? '?'}</span
								>
							{/if}
							<div class="account-info">
								<span class="account-name" data-testid="account-name">{conn.accountName}</span>
								<div class="account-meta">
									<span class="account-provider"
										>{providerLabel[conn.provider] ?? conn.provider}</span
									>
									{#if conn.instanceUrl}
										<span class="account-url mono" data-testid="instance-url"
											>{conn.instanceUrl.replace(/^https?:\/\//, '')}</span
										>
									{/if}
									<span class="account-age" data-testid="connection-age"
										>{connectionAge(conn.createdAt)}</span
									>
								</div>
							</div>
						</div>
						<div class="account-actions">
							<form
								method="post"
								action="?/refresh"
								use:enhance={() => {
									refreshing = conn.id;
									return async ({ update }) => {
										refreshing = null;
										await update();
									};
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
		{/if}
		<a
			href={resolve('/settings/providers')}
			class="btn-secondary add-link"
			data-testid="add-provider-link"
		>
			+ Add provider
		</a>
	</section>

	<!-- SSH Deploy Key -->
	<section class="section" data-testid="ssh-section">
		<h2 class="section-title">SSH Deploy Key</h2>
		<div class="form-card">
			<p class="form-hint-block">
				Add this read-only public key to your repositories for private repo access via SSH.
			</p>
			{#if data.sshPublicKey}
				<div class="key-display" data-testid="ssh-key-display">
					<code class="key-value mono" data-testid="ssh-key-value">{data.sshPublicKey}</code>
					<button class="btn-copy" onclick={copyKey} data-testid="copy-key-btn">
						{keyCopied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			{:else}
				<p class="empty-text" data-testid="no-ssh-key">No deploy key generated yet.</p>
			{/if}
			<form
				method="post"
				action="?/generateSshKey"
				use:enhance={() => {
					generatingKey = true;
					return async ({ update }) => {
						generatingKey = false;
						await update();
					};
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
			{#if form?.keyGenerated}
				<span class="save-success" data-testid="key-generated">Key generated</span>
			{/if}
		</div>
	</section>

	<!-- Default Webhook Settings -->
	<section class="section" data-testid="defaults-section">
		<h2 class="section-title">Default Webhook Settings</h2>
		<form
			method="post"
			action="?/saveDefaults"
			use:enhance={() => {
				savingDefaults = true;
				return async ({ update }) => {
					savingDefaults = false;
					await update();
				};
			}}
		>
			<div class="form-card">
				<label class="toggle-row" data-testid="auto-webhook-toggle">
					<input
						type="checkbox"
						name="autoWebhook"
						checked={data.defaults.autoWebhook}
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
						checked={data.defaults.commitStatus}
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
						checked={data.defaults.deployPreviews}
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
					{#if form?.defaultsSaved}
						<span class="save-success" data-testid="defaults-saved">Saved</span>
					{/if}
				</div>
			</div>
		</form>
	</section>
</div>

<style>
	.git-settings-page {
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

	.form-hint-block {
		font-size: 0.8125rem;
		color: var(--color-text-2);
	}
	.form-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.empty-text {
		color: var(--color-text-2);
		font-size: 0.85rem;
	}
	.inline-link {
		color: var(--color-accent);
		text-decoration: underline;
	}
	.inline-link:hover {
		opacity: 0.8;
	}

	/* Accounts list */
	.accounts-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.account-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.account-left {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.account-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.account-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.account-name {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.account-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.account-provider {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}
	.account-url {
		font-size: 0.7rem;
		color: var(--color-text-2);
		opacity: 0.7;
	}
	.account-age {
		font-size: 0.7rem;
		color: var(--color-text-2);
		opacity: 0.6;
	}
	.account-actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	/* Provider icon badges */
	.provider-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		font-size: 0.7rem;
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

	/* SSH key display */
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
		accent-color: var(--color-accent);
		width: 16px;
		height: 16px;
	}
	.toggle-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toggle-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.toggle-hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
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
		text-decoration: none;
		text-align: center;
	}
	.btn-secondary:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-sm {
		padding: var(--space-1) var(--space-3);
		font-size: 0.75rem;
	}

	.btn-danger-sm {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-failed);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: 0.75rem;
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
		margin-top: var(--space-2);
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	.add-link {
		display: inline-flex;
		align-self: flex-start;
	}

	.save-success {
		font-size: 0.8125rem;
		color: var(--color-live);
	}
</style>
