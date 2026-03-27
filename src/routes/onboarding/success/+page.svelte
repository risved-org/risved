<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Setup complete – Risved</title>
</svelte:head>

<div class="onboarding">
	<div class="onboarding-card">
		<div class="success-icon" aria-hidden="true">
			<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
				<circle cx="24" cy="24" r="24" fill="color-mix(in srgb, var(--color-live) 12%, transparent)" />
				<path
					d="M15 25l6 6 12-14"
					stroke="var(--color-live)"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</div>

		<header>
			<h1>You're all set</h1>
			<p class="subtitle">
				{#if data.deployType === 'starter'}
					Your starter app is being deployed. It will be live shortly.
				{:else}
					Your repository is being deployed. It will be live shortly.
				{/if}
			</p>
		</header>

		{#if data.appUrl}
			<div class="app-url">
				<span class="url-label">Your app</span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external URL -->
				<a href={data.appUrl} target="_blank" rel="noopener noreferrer" class="url-link">
					{data.appUrl}
				</a>
			</div>
		{/if}

		<div class="next-cards">
			<h2 class="next-heading">What's next</h2>

			<div class="card-grid">
				<div class="next-card">
					<div class="card-icon">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
							<rect
								x="2"
								y="3"
								width="16"
								height="14"
								rx="2"
								stroke="currentColor"
								stroke-width="1.5"
							/>
							<path
								d="M6 9l3 3 5-5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<h3>Deploy another project</h3>
					<p>Add more apps from Git repositories or starter templates.</p>
				</div>

				<div class="next-card">
					<div class="card-icon">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
							<circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" />
							<path d="M10 5v5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
						</svg>
					</div>
					<h3>Add a custom domain</h3>
					<p>Point your own domain to any deployed project.</p>
				</div>

				<div class="next-card">
					<div class="card-icon">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
							<path
								d="M3 5h14M3 10h14M3 15h14"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					</div>
					<h3>Set up webhooks</h3>
					<p>Trigger deployments automatically on push events.</p>
				</div>
			</div>
		</div>

		<form
			method="post"
			action="?/dashboard"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			<button type="submit" class="btn-primary" disabled={submitting}>
				{submitting ? 'Opening…' : 'Open dashboard'}
			</button>
		</form>
	</div>
</div>

<style>
	.onboarding-card {
		width: 100%;
		max-width: 560px;
	}

	.success-icon {
		margin-bottom: var(--space-4);
	}

	header {
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: 2rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	/* App URL display */
	.app-url {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-5);
	}

	.url-label {
		font-size: .875rem;
		color: var(--color-text-2);
		font-weight: 500;
		white-space: nowrap;
	}

	.url-link {
		font-family: var(--font-mono);
		font-size: .875rem;
		color: var(--color-accent);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.url-link:hover {
		text-decoration: underline;
	}

	/* What's next section */
	.next-cards {
		margin-bottom: var(--space-5);
	}

	.next-heading {
		font-family: var(--font-sans);
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-1);
		margin-bottom: var(--space-3);
	}

	.card-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.next-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.card-icon {
		color: var(--color-text-2);
		margin-bottom: var(--space-1);
	}

	.next-card h3 {
		font-family: var(--font-sans);
		font-size: .875rem;
		font-weight: 600;
		color: var(--color-text-0);
	}

	.next-card p {
		font-size: .875rem;
		color: var(--color-text-2);
		line-height: 1.4;
	}

	/* CTA */
	form {
		display: flex;
	}
</style>
