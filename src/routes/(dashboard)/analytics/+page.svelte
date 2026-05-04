<svelte:head>
	<title>Analytics – Risved</title>
</svelte:head>

<article class="analytics-page">
	<h1>Analytics</h1>
	<p class="placeholder">Coming soon.</p>
</article>

<style>
	.analytics-page {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: var(--space-4) 0;
		gap: var(--space-4);
		width: min(100% - 2rem, 64rem);
		margin: 0 auto;
	}

	h1 {
		font-size: 2rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	.placeholder {
		color: var(--color-text-2);
	}
</style>
