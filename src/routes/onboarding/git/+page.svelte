<script lang="ts">
	import { resolve } from '$app/paths'
	import type { PageData, ActionData } from './$types'
	import StepIndicator from '../StepIndicator.svelte'
	import GitProviderCards from '$lib/components/GitProviderCards.svelte'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const providerLabel: Record<string, string> = {
		github: 'GitHub',
		gitlab: 'GitLab',
		codeberg: 'Codeberg',
		forgejo: 'Forgejo / Gitea'
	}

	const hasConnections = $derived(data.connections.length > 0)
</script>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={3} />

		<header>
			<h1>Connect a Git provider</h1>
			<p class="subtitle">
				Link your GitHub, GitLab, Codeberg, or Forgejo account to import repositories
				without pasting URLs. You can skip this and do it later.
			</p>
		</header>

		<GitProviderCards
			connections={data.connections}
			isCloud={data.isCloud}
			{form}
			connectRedirect="/onboarding/git"
		/>

		{#if hasConnections}
			<section class="connected" data-testid="connected-accounts">
				<h2 class="section-title">Connected</h2>
				{#each data.connections as conn (conn.id)}
					<div class="account-row">
						{#if conn.avatarUrl}
							<img src={conn.avatarUrl} alt="" class="account-avatar" />
						{:else}
							<span class="account-badge">
								{providerLabel[conn.provider]?.[0] ?? '?'}
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
				<a href={resolve('/onboarding/deploy')} class="btn-primary" data-testid="continue-btn">
					Continue
				</a>
			{/if}
			<form method="post" action="?/skip">
				<button type="submit" class="btn-secondary" data-testid="skip-btn">
					{hasConnections ? 'Skip provider setup' : 'Skip – set up later'}
				</button>
			</form>
		</div>
	</div>
</div>

<style>
	.onboarding-card {
		width: 100%;
		max-width: 480px;
	}

	header {
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: 2rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	/* Connected section */
	.connected {
		margin-top: var(--space-5);
		margin-bottom: var(--space-5);
	}

	.section-title {
		font-family: var(--font-sans);
		font-size: .875rem;
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

	.account-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		background: var(--color-bg-2);
		color: var(--color-text-2);
		font-size: .875rem;
		font-weight: 600;
		flex-shrink: 0;
	}

	.account-name {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-0);
	}

	.account-provider {
		font-size: .875rem;
		color: var(--color-text-2);
		margin-left: auto;
	}

	/* Actions */
	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: stretch;
		margin-top: var(--space-5);
	}

	.btn-secondary {
		width: 100%;
		padding: .75rem var(--space-4);
		background: transparent;
		color: var(--color-text-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.btn-secondary:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	form {
		display: contents;
	}
</style>
