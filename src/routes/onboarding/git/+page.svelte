<script lang="ts">
	import { resolve } from '$app/paths'
	import type { PageData } from './$types'
	import StepIndicator from '../StepIndicator.svelte'

	let { data }: { data: PageData } = $props()

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
</script>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={1} />

		<header>
			<h1>Connect a Git provider</h1>
			<p class="subtitle">
				Link your GitHub, GitLab, or Forgejo account to import repositories
				without pasting URLs. You can skip this and do it later.
			</p>
		</header>

		<section class="cards">
			<a
				href={resolve('/api/git/github?action=connect&redirect=/onboarding/git')}
				class="provider-card"
				data-testid="github-card"
			>
				<span class="provider-icon github">{providerIcon.github}</span>
				<div>
					<h2 class="card-name">GitHub</h2>
					<p class="card-desc">OAuth · github.com</p>
				</div>
			</a>

			<a
				href={resolve('/api/git/gitlab?action=connect&redirect=/onboarding/git')}
				class="provider-card"
				data-testid="gitlab-card"
			>
				<span class="provider-icon gitlab">{providerIcon.gitlab}</span>
				<div>
					<h2 class="card-name">GitLab</h2>
					<p class="card-desc">OAuth · cloud or self-hosted</p>
				</div>
			</a>

			<a
				href={resolve('/settings/providers')}
				class="provider-card"
				data-testid="forgejo-card"
			>
				<span class="provider-icon forgejo">{providerIcon.forgejo}</span>
				<div>
					<h2 class="card-name">Forgejo / Gitea</h2>
					<p class="card-desc">API token · set up in settings</p>
				</div>
			</a>
		</section>

		{#if hasConnections}
			<section class="connected" data-testid="connected-accounts">
				<h2 class="section-title">Connected</h2>
				{#each data.connections as conn (conn.id)}
					<div class="account-row">
						{#if conn.avatarUrl}
							<img src={conn.avatarUrl} alt="" class="account-avatar" />
						{:else}
							<span class="provider-icon {conn.provider} sm">
								{providerIcon[conn.provider] ?? '?'}
							</span>
						{/if}
						<span class="account-name">{conn.accountName}</span>
						<span class="account-provider">{providerLabel[conn.provider] ?? conn.provider}</span>
					</div>
				{/each}
			</section>
		{/if}

		<div class="actions">
			{#if hasConnections}
				<a href={resolve('/onboarding/domain')} class="btn-primary" data-testid="continue-btn">
					Continue
				</a>
			{/if}
			<form method="post" action="?/skip">
				<button type="submit" class="btn-skip" data-testid="skip-btn">
					{hasConnections ? 'Skip provider setup' : 'Skip — set up later'}
				</button>
			</form>
		</div>
	</div>
</div>

<style>
	.onboarding {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-4);
	}

	.onboarding-card {
		width: 100%;
		max-width: 480px;
	}

	header {
		margin-bottom: var(--space-6);
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.subtitle {
		color: var(--color-text-1);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	/* Provider cards */
	.cards {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
	}

	.provider-card {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-0);
		text-decoration: none;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.provider-card:hover {
		border-color: var(--color-accent);
		background: rgba(59, 130, 246, 0.05);
	}

	.card-name {
		font-size: 0.9rem;
		font-weight: 600;
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

	.provider-icon.sm {
		width: 28px;
		height: 28px;
		font-size: 0.65rem;
	}

	/* Connected section */
	.connected {
		margin-bottom: var(--space-6);
	}

	.section-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: var(--space-2);
	}

	.account-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.account-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
	}

	.account-name {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-0);
	}

	.account-provider {
		font-size: 0.75rem;
		color: var(--color-text-2);
		margin-left: auto;
	}

	/* Actions */
	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: stretch;
	}

	.btn-primary {
		display: block;
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
		transition:
			background 0.15s,
			opacity 0.15s;
	}

	.btn-primary:hover {
		background: var(--color-accent-dim);
	}

	.btn-skip {
		width: 100%;
		padding: var(--space-2) var(--space-4);
		background: transparent;
		color: var(--color-text-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.btn-skip:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	form {
		display: contents;
	}
</style>
