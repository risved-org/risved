<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let activeTab = $state('github');
	let urlCopied = $state(false);
	let secretCopied = $state(false);

	const providers = [
		{ id: 'github', label: 'GitHub' },
		{ id: 'gitlab', label: 'GitLab' },
		{ id: 'forgejo', label: 'Forgejo' },
		{ id: 'gitea', label: 'Gitea' },
		{ id: 'codeberg', label: 'Codeberg' },
		{ id: 'bitbucket', label: 'Bitbucket' }
	];

	function copyToClipboard(text: string, field: 'url' | 'secret') {
		navigator.clipboard.writeText(text);
		if (field === 'url') {
			urlCopied = true;
			setTimeout(() => (urlCopied = false), 2000);
		} else {
			secretCopied = true;
			setTimeout(() => (secretCopied = false), 2000);
		}
	}

	function guideSteps(provider: string): string[] {
		const url = data.payloadUrl;
		const secret = data.project.webhookSecret ?? '(not set)';

		switch (provider) {
			case 'github':
				return [
					'Go to your repository → Settings → Webhooks → Add webhook',
					`Set Payload URL to: ${url}`,
					'Set Content type to: application/json',
					`Set Secret to: ${secret}`,
					'Under "Which events would you like to trigger this webhook?", select "Let me select individual events"',
					'Check "Pushes" and "Pull requests"',
					'Click "Add webhook"'
				];
			case 'gitlab':
				return [
					'Go to your project → Settings → Webhooks',
					`Set URL to: ${url}`,
					`Set Secret token to: ${secret}`,
					'Under Trigger, check "Push events" and "Merge request events"',
					'Click "Add webhook"'
				];
			case 'forgejo':
				return [
					'Go to your repository → Settings → Webhooks → Add Webhook → Forgejo',
					`Set Target URL to: ${url}`,
					`Set Secret to: ${secret}`,
					'Set Content type to: application/json',
					'Under "Trigger On", select "Push Events" and "Pull Request"',
					'Click "Add Webhook"'
				];
			case 'gitea':
				return [
					'Go to your repository → Settings → Webhooks → Add Webhook → Gitea',
					`Set Target URL to: ${url}`,
					`Set Secret to: ${secret}`,
					'Set Content type to: application/json',
					'Under "Trigger On", select "Push Events" and "Pull Request"',
					'Click "Add Webhook"'
				];
			case 'codeberg':
				return [
					'Go to your repository → Settings → Webhooks → Add Webhook → Gitea',
					`Set Target URL to: ${url}`,
					`Set Secret to: ${secret}`,
					'Set Content type to: application/json',
					'Codeberg uses the Gitea webhook format – select "Push Events" and "Pull Request"',
					'Click "Add Webhook"'
				];
			case 'bitbucket':
				return [
					'Go to your repository → Repository settings → Webhooks → Add webhook',
					`Set URL to: ${url}`,
					'Note: Bitbucket Cloud does not support webhook secrets natively – use IP allowlisting or a reverse proxy for security',
					'Under Triggers, select "Repository push" and "Pull request merged"',
					'Click "Save"'
				];
			default:
				return [];
		}
	}
</script>

<svelte:head>
	<title>Webhooks – {data.project.name} – Risved</title>
</svelte:head>

<div class="webhook-config">
	<nav class="sub-breadcrumb">
		<a href={resolve(`/projects/${data.project.slug}/settings`)} class="breadcrumb-link">← Settings</a>
	</nav>

	<!-- Payload URL -->
	<section data-testid="payload-url-section">
		<h2 class="section-title">Payload URL</h2>
		<div class="copy-field">
			<code class="field-value mono" data-testid="payload-url">{data.payloadUrl}</code>
			<button
				class="btn-copy"
				onclick={() => copyToClipboard(data.payloadUrl, 'url')}
				data-testid="copy-url-btn"
			>
				{urlCopied ? 'Copied!' : 'Copy'}
			</button>
		</div>
	</section>

	<!-- Webhook Secret -->
	<section data-testid="secret-section">
		<h2 class="section-title">Webhook Secret</h2>
		<div class="copy-field">
			<code class="field-value mono" data-testid="webhook-secret">
				{data.project.webhookSecret ?? 'Not configured'}
			</code>
			<div class="secret-actions">
				{#if data.project.webhookSecret}
					<button
						class="btn-copy"
						onclick={() => copyToClipboard(data.project.webhookSecret ?? '', 'secret')}
						data-testid="copy-secret-btn"
					>
						{secretCopied ? 'Copied!' : 'Copy'}
					</button>
				{/if}
				<form method="post" action="?/regenerate" use:enhance>
					<button type="submit" class="btn-regen" data-testid="regenerate-btn"> Regenerate </button>
				</form>
			</div>
		</div>
	</section>

	<!-- Provider Setup Guides -->
	<section data-testid="provider-guides">
		<h2 class="section-title">Setup Guide</h2>
		<div class="tab-bar" data-testid="provider-tabs">
			{#each providers as p (p.id)}
				<button
					class="tab"
					class:tab-active={activeTab === p.id}
					onclick={() => (activeTab = p.id)}
					data-testid="provider-tab-{p.id}"
				>
					{p.label}
				</button>
			{/each}
		</div>
		<div class="guide-content" data-testid="guide-content">
			<ol class="guide-steps">
				{#each guideSteps(activeTab) as step, i (i)}
					<li class="guide-step">{step}</li>
				{/each}
			</ol>
		</div>
	</section>

	<!-- Delivery Log Link -->
	<section data-testid="deliveries-link-section">
		<div class="delivery-link-row">
			<span class="section-title">Recent Deliveries</span>
			<a
				href={resolve(`/projects/${data.project.slug}/webhooks/deliveries`)}
				class="btn-sm"
				data-testid="view-deliveries-btn"
			>
				View delivery log
			</a>
		</div>
	</section>

	<!-- Branch Filter & Event Toggles -->
	<section data-testid="config-section">
		<h2 class="section-title">Webhook Settings</h2>
		<form method="post" action="?/update" use:enhance class="config-form">
			<div class="form-group">
				<label for="branch" class="form-label">Branch filter</label>
				<input
					type="text"
					id="branch"
					name="branch"
					value={data.project.branch}
					class="form-input mono"
					placeholder="main"
					data-testid="branch-input"
				/>
				<span class="form-hint">Only webhooks targeting this branch will trigger a deployment.</span
				>
			</div>

			<fieldset class="form-group">
				<legend class="form-label">Events</legend>
				<div class="toggle-list">
					<label class="toggle-row" data-testid="toggle-push">
						<input
							type="checkbox"
							name="webhookPushEnabled"
							checked={data.project.webhookPushEnabled}
						/>
						<span class="toggle-label">Push to branch</span>
					</label>
					<label class="toggle-row" data-testid="toggle-pr-merged">
						<input
							type="checkbox"
							name="webhookPrMergedEnabled"
							checked={data.project.webhookPrMergedEnabled}
						/>
						<span class="toggle-label">PR merged</span>
					</label>
				</div>
			</fieldset>

			<button type="submit" class="btn-save" data-testid="save-btn">Save settings</button>
		</form>
	</section>
</div>

<style>
	.webhook-config {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.sub-breadcrumb {
		margin-bottom: calc(-1 * var(--space-3));
	}
	.breadcrumb-link {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.breadcrumb-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	/* Copy field */
	.copy-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.field-value {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-0);
	}
	.secret-actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn-copy,
	.btn-regen {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-copy:hover,
	.btn-regen:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Tabs */
	.tab-bar {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
	}
	.tab {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab:hover {
		color: var(--color-text-1);
	}
	.tab-active {
		color: var(--color-text-0);
		border-bottom-color: var(--color-accent);
	}

	/* Guide */
	.guide-content {
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.guide-steps {
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.guide-step {
		font-size: .875rem;
		color: var(--color-text-1);
		line-height: 1.5;
		word-break: break-all;
	}

	/* Config form */
	.config-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.form-group {
		gap: var(--space-2);
	}
	fieldset.form-group {
		border: none;
		padding: 0;
		margin: 0;
	}
	.form-input {
		background: var(--color-bg-1);
		border-width: 1px;
		font-size: .875rem;
	}

	/* Toggles */
	.toggle-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.toggle-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		font-size: .875rem;
	}
	.toggle-row input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--color-accent);
		cursor: pointer;
	}
	.toggle-label {
		color: var(--color-text-1);
		font-size: 1rem;
	}

	/* Delivery link */
	.delivery-link-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	/* Save button */
	.btn-save {
		align-self: flex-start;
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-bg-0);
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-save:hover {
		background: var(--color-accent-dim);
	}
</style>
