<svelte:head>
	<title>Jura</title>
	<meta name="description" content="Deploy to Jura — a design-led, Deno-only PaaS" />
</svelte:head>

<section class="landing">
	<h1>jura<span class="dot">.</span></h1>
	<p class="tagline">Deploy to Jura</p>
</section>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		flex: 1;
		gap: var(--space-2);
	}

	h1 {
		font-family: var(--font-mono);
		font-size: 3rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--color-text-0);
	}

	.dot {
		color: var(--color-accent);
	}

	.tagline {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--color-text-2);
	}
</style>
