<script lang="ts">
	import { page } from '$app/state'
	import { resolve } from '$app/paths'

	let { data, children } = $props()

	const IN_PROGRESS = new Set(['running', 'cloning', 'detecting', 'building', 'starting'])

	function statusClass(status: string): string {
		if (status === 'live') return 'dot-live'
		if (status === 'failed') return 'dot-failed'
		if (IN_PROGRESS.has(status)) return 'dot-building'
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

	/* Shared tab-content styles */
	.tab-content :global(.section-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.tab-content :global(.muted) {
		color: var(--color-text-2);
		font-size: .875rem;
	}
	.tab-content :global(.btn-sm) {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
		text-decoration: none;
	}
	.tab-content :global(.btn-sm:hover) {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
		text-decoration: none;
	}
	.tab-content :global(.btn-sm:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tab-content :global(.status-dot) {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.tab-content :global(.dot-live) {
		background: var(--color-live);
		box-shadow: 0 0 6px var(--color-live);
	}
	.tab-content :global(.dot-failed) {
		background: var(--color-failed);
	}
	.tab-content :global(.dot-building) {
		background: var(--color-building);
	}
	.tab-content :global(.dot-stopped) {
		background: var(--color-stopped);
	}

	.tab-content :global(.deploy-list) {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.tab-content :global(.deploy-row) {
		display: grid;
		grid-template-columns: 20px 80px 1fr auto 80px;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		gap: var(--space-2);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
		color: var(--color-text-0);
		text-decoration: none;
		transition: background 0.1s;
		width: 100%;
		text-align: left;
		background: transparent;
	}
	.tab-content :global(.deploy-row:last-child) {
		border-bottom: none;
	}
	.tab-content :global(.deploy-row:hover) {
		background: var(--color-bg-2);
		text-decoration: none;
	}
	.tab-content :global(.deploy-status) {
		color: var(--color-text-1);
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.tab-content :global(.deploy-time),
	.tab-content :global(.deploy-duration) {
		color: var(--color-text-2);
	}
	.tab-content :global(.deploy-actions) {
		text-align: right;
	}
	.tab-content :global(.trigger-badge) {
		padding: 1px 6px;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 500;
	}
	.tab-content :global(.btn-rollback) {
		padding: 2px 8px;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab-content :global(.btn-rollback:hover) {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
	.tab-content :global(.btn-rollback:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tab-content :global(.charts-grid) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
	@media (max-width: 600px) {
		.tab-content :global(.charts-grid) {
			grid-template-columns: 1fr;
		}
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
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: var(--space-5);
	}

	.tab {
		padding: var(--space-2) var(--space-3);
		border-right: 1.5px solid var(--color-border);
		color: var(--color-text-2);
		font-size: .875rem;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.15s, background 0.15s;
	}
	.tab:last-child {
		border-right: none;
	}
	.tab:hover {
		color: var(--color-text-0);
		background: var(--color-bg-2);
		text-decoration: none;
	}
	.tab-active {
		color: var(--color-text-0);
		background: var(--color-bg-2);
	}
</style>
