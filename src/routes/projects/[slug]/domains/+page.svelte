<script lang="ts">
	import { resolve } from '$app/paths'
	import DomainList from './DomainList.svelte'
	import AddDomainForm from './AddDomainForm.svelte'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showAddForm = $state(false)
	let copiedKey = $state<string | null>(null)
	/** Copy a DNS address and briefly identify the copied record. */
	function copyIp(ip: string, key: string) {
		navigator.clipboard.writeText(ip)
		copiedKey = key
		setTimeout(() => {
			if (copiedKey === key) copiedKey = null
		}, 2000)
	}
</script>

<svelte:head>
	<title>Domains – {data.project.name} – Risved</title>
</svelte:head>

<div class="domains-page">
	<nav class="sub-breadcrumb">
		<a href={resolve(`/projects/${data.project.slug}/settings`)} class="breadcrumb-link"
			>← Settings</a
		>
	</nav>

	<h1 class="page-title">Domains</h1>

	{#if data.defaultSubdomain}
		<section data-testid="default-subdomain-section">
			<h2 class="section-title">Default subdomain</h2>
			<div class="form-card">
				<a
					href="https://{data.defaultSubdomain}"
					target="_blank"
					rel="noopener"
					class="default-subdomain mono"
				>
					{data.defaultSubdomain}
				</a>
				<p class="form-hint">Auto-routed via the wildcard DNS record on the control plane.</p>
			</div>
		</section>
	{/if}

	<DomainList {data} {showAddForm} {copiedKey} {copyIp} onadd={() => (showAddForm = true)} />
	{#if showAddForm}
		<AddDomainForm
			{data}
			{form}
			{copiedKey}
			{copyIp}
			onadded={() => (showAddForm = false)}
			oncancel={() => (showAddForm = false)}
		/>
	{/if}
</div>

<style>
	.domains-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 40rem;
		width: 100%;
		margin: 0 auto;
	}

	.sub-breadcrumb {
		margin-bottom: calc(-1 * var(--space-3));
	}
	.breadcrumb-link {
		font-size: 0.875rem;
		color: var(--color-text-2);
	}
	.breadcrumb-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	.default-subdomain {
		font-size: 1rem;
		color: var(--color-accent);
		word-break: break-all;
	}
	.default-subdomain:visited {
		color: var(--color-accent);
	}
	.default-subdomain:hover {
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		text-underline-offset: 0.25em;
	}
</style>
