<script lang="ts">
	import { page } from '$app/state'
	import { resolve } from '$app/paths'

	let { data, children } = $props()

	function statusClass(status: string): string {
		if (status === 'live') return 'dot-live'
		if (status === 'failed') return 'dot-failed'
		if (status === 'building') return 'dot-building'
		return 'dot-stopped'
	}

	const tabs = [
		{ href: '', label: 'Overview' },
		{ href: '/deployments', label: 'Deployments' },
		{ href: '/logs', label: 'Logs' },
		{ href: '/metrics', label: 'Metrics' },
		{ href: '/settings', label: 'Settings' }
	]

	let currentPath = $derived(page.url.pathname)

	const settingsSubpaths = ['/settings', '/domains', '/webhooks', '/checks', '/crons']

	function isActive(tabHref: string): boolean {
		const base = `/projects/${data.project.slug}`
		if (tabHref === '') {
			return currentPath === base || currentPath === base + '/'
		}
		if (tabHref === '/settings') {
			return settingsSubpaths.some((p) => currentPath.startsWith(base + p))
		}
		return currentPath.startsWith(base + tabHref)
	}
</script>

<svelte:head>
	<title>{data.project.name} – Risved</title>
</svelte:head>

<article class="project-shell">
	<header class="project-header">
		<a href={resolve('/')} class="back-link">← Dashboard</a>
		<div class="header-row">
			<h1>{data.project.name}</h1>
			<span class="status-dot {statusClass(data.project.status)}"></span>
			{#if data.project.framework}
				<span class="framework-badge">{data.project.framework}</span>
			{/if}
		</div>
		{#if data.project.domain}
			<a
				href="https://{data.project.domain}"
				target="_blank"
				rel="noopener"
				class="domain-link mono"
			>
				{data.project.domain} ↗
			</a>
		{/if}
	</header>

	<nav class="tab-bar" data-testid="project-tabs">
		{#each tabs as tab (tab.href)}
			<a
				href={resolve(`/projects/${data.project.slug}${tab.href}`)}
				class="tab"
				class:tab-active={isActive(tab.href)}
			>
				{tab.label}
			</a>
		{/each}
	</nav>

	<div class="tab-content">
		{@render children()}
	</div>
</article>

<style>
	.project-shell {
		display: flex;
		flex-direction: column;
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-4) var(--space-4) var(--space-6);
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.tab-content :global(section) {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.project-header {
		margin-bottom: var(--space-3);
	}

	.back-link {
		font-size: .875rem;
		color: var(--color-text-2);
		display: inline-block;
		margin-bottom: var(--space-2);
	}
	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	.header-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.domain-link {
		font-size: .875rem;
		color: var(--color-accent);
		margin-top: var(--space-1);
	}

	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot-live {
		background: var(--color-live);
		box-shadow: 0 0 6px var(--color-live);
	}
	.dot-failed {
		background: var(--color-failed);
	}
	.dot-building {
		background: var(--color-building);
	}
	.dot-stopped {
		background: var(--color-stopped);
	}

	.framework-badge {
		padding: 1px 8px;
		background: var(--color-bg-3);
		border-radius: var(--radius-sm);
		font-size: .875rem;
		color: var(--color-text-1);
	}

	.tab-bar {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-5);
		overflow-x: auto;
	}

	.tab {
		padding: var(--space-2) var(--space-3);
		border-bottom: 2px solid transparent;
		color: var(--color-text-2);
		font-size: .875rem;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.15s;
	}
	.tab:hover {
		color: var(--color-text-1);
		text-decoration: none;
	}
	.tab-active {
		color: var(--color-text-0);
		border-bottom-color: var(--color-accent);
	}
</style>
