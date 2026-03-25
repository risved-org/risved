<script lang="ts">
	import { page } from '$app/state'
	import { resolve } from '$app/paths'
	import { locales, localizeHref } from '$lib/paraglide/runtime'
	import '@fontsource/bbh-hegarty/400.css'
	import '@fontsource/mozilla-text/500.css'
	import '@fontsource/mozilla-text/700.css'
	import '@fontsource/cascadia-code/400.css'
	import './layout.css'

	let { data, children } = $props()

	let updateDismissed = $state(false)

	let showUpdateBanner = $derived(
		data.updateAvailable && !updateDismissed
	)
</script>

<div class="app">
	{#if showUpdateBanner}
		<aside class="update-banner" data-testid="update-banner">
			<span>
				Risved {data.updateAvailable?.latestVersion} is available.
				<a href={resolve('/settings')}>Update now</a>
			</span>
			<button
				class="banner-dismiss"
				onclick={() => updateDismissed = true}
				aria-label="Dismiss update notification"
			>&times;</button>
		</aside>
	{/if}
	<main>{@render children()}</main>
</div>

<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>{locale}</a>
	{/each}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.update-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		background: var(--color-bg-1);
		border-bottom: 1px solid var(--color-border);
		font-size: 1rem;
		color: var(--color-text-1);
	}
	.update-banner a {
		color: var(--color-accent);
		font-weight: 500;
	}
	.banner-dismiss {
		background: none;
		border: none;
		color: var(--color-text-2);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0 var(--space-1);
	}
	.banner-dismiss:hover {
		color: var(--color-text-0);
	}
</style>
