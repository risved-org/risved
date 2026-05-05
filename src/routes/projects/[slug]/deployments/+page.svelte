<script lang="ts">
	import { resolve } from '$app/paths'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	let statusFilter = $state('all')
	let rollingBack = $state<string | null>(null)

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return '–'
		const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
		if (seconds < 60) return 'just now'
		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes}m ago`
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours}h ago`
		return `${Math.floor(hours / 24)}d ago`
	}

	function duration(start: string | null, end: string | null): string {
		if (!start) return '–'
		const endTime = end ? new Date(end).getTime() : Date.now()
		const secs = Math.floor((endTime - new Date(start).getTime()) / 1000)
		const mins = Math.floor(secs / 60)
		return mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`
	}

	const IN_PROGRESS = new Set(['running', 'cloning', 'detecting', 'building', 'starting'])

	function statusClass(status: string): string {
		if (status === 'live') return 'dot-live'
		if (status === 'failed') return 'dot-failed'
		if (IN_PROGRESS.has(status)) return 'dot-building'
		return 'dot-stopped'
	}

	function deployLabel(status: string): string {
		if (status === 'live') return 'Success'
		if (status === 'failed') return 'Failed'
		if (status === 'stopped') return 'Stopped'
		if (status === 'building' || status === 'running') return 'Building'
		if (status === 'cloning') return 'Cloning'
		if (status === 'detecting') return 'Detecting'
		if (status === 'starting') return 'Starting'
		return status.charAt(0).toUpperCase() + status.slice(1)
	}

	type Dep = (typeof data.deployments)[number]

	/** Group consecutive deployments by commit SHA */
	function groupByCommit(deps: Dep[]): { sha: string | null, items: Dep[] }[] {
		const groups: { sha: string | null, items: Dep[] }[] = []
		for (const dep of deps) {
			const last = groups[groups.length - 1]
			if (last && last.sha === dep.commitSha) {
				last.items.push(dep)
			} else {
				groups.push({ sha: dep.commitSha, items: [dep] })
			}
		}
		return groups
	}

	let filtered = $derived(
		statusFilter === 'all'
			? data.deployments
			: data.deployments.filter((d) => {
					if (statusFilter === 'succeeded') return d.status === 'live'
					if (statusFilter === 'failed') return d.status === 'failed'
					return true
				})
	)

	let groups = $derived(groupByCommit(filtered))

	let expandedSha = $state<string | null>(null)

	async function handleRollback(e: Event, depId: string) {
		e.preventDefault()
		e.stopPropagation()
		rollingBack = depId
		try {
			await fetch(`/api/projects/${data.project.id}/deployments/${depId}/rollback`, {
				method: 'POST'
			})
			window.location.reload()
		} finally {
			rollingBack = null
		}
	}
</script>

<h1 class="page-title">Deployments</h1>

<section data-testid="deployments-full">
	<header class="section-header">
		<h2 class="section-title">All Deployments</h2>
		<nav class="filter-bar" data-testid="status-filter">
			{#each ['all', 'succeeded', 'failed'] as f (f)}
				<button
					class="filter-btn"
					class:filter-active={statusFilter === f}
					onclick={() => (statusFilter = f)}
				>
					{f === 'all' ? 'All' : f === 'succeeded' ? 'Succeeded' : 'Failed'}
				</button>
			{/each}
		</nav>
	</header>

	{#if filtered.length === 0}
		<p class="empty-text">No deployments match the filter.</p>
	{:else}
		<ul class="deploy-list">
			{#each groups as group (group.sha ?? group.items[0].id)}
				{#if group.items.length === 1}
					{@const dep = group.items[0]}
					<li>
						<a
							href={resolve(`/projects/${data.project.slug}/deployments/${dep.id}`)}
							class="deploy-row"
							data-testid="deploy-row"
						>
							<span class="status-dot {statusClass(dep.status)}"></span>
							<span class="deploy-sha mono">{dep.commitSha?.slice(0, 7) ?? '–'}</span>
							<span class="deploy-status">
								{deployLabel(dep.status)}
								{#if dep.triggerType === 'rollback'}
									<span class="badge-md badge-accent">Rollback</span>
								{/if}
							</span>
							<span class="deploy-time mono">{timeAgo(dep.createdAt)}</span>
							<span class="deploy-actions">
								{#if (dep.status === 'live' || dep.status === 'stopped') && dep.imageTag}
									<button
										class="btn-rollback"
										disabled={rollingBack === dep.id}
										onclick={(e) => handleRollback(e, dep.id)}
									>
										{rollingBack === dep.id ? 'Rolling back…' : 'Rollback'}
									</button>
								{:else}
									<span class="deploy-duration mono">{duration(dep.createdAt, dep.finishedAt)}</span>
								{/if}
							</span>
						</a>
					</li>
				{:else}
					{@const failCount = group.items.filter((d) => d.status === 'failed').length}
					{@const successCount = group.items.filter((d) => d.status === 'live').length}
					{@const latest = group.items[0]}
					<li>
						<button
							class="deploy-row deploy-group-header"
							data-testid="deploy-group"
							onclick={() => (expandedSha = expandedSha === group.sha ? null : group.sha)}
						>
							<span class="status-dot {statusClass(latest.status)}"></span>
							<span class="deploy-sha mono">{group.sha?.slice(0, 7) ?? '–'}</span>
							<span class="deploy-status">
								{group.items.length} deploys
								{#if failCount > 0}
									<span class="badge-sm badge-failed">{failCount} failed</span>
								{/if}
								{#if successCount > 0}
									<span class="badge-sm badge-live">{successCount} succeeded</span>
								{/if}
							</span>
							<span class="deploy-time mono">{timeAgo(latest.createdAt)}</span>
							<span class="deploy-actions">
								<span class="expand-icon">{expandedSha === group.sha ? '▾' : '▸'}</span>
							</span>
						</button>
					</li>
					{#if expandedSha === group.sha}
						{#each group.items as dep (dep.id)}
							<li>
								<a
									href={resolve(`/projects/${data.project.slug}/deployments/${dep.id}`)}
									class="deploy-row deploy-nested"
									data-testid="deploy-row-nested"
								>
									<span class="status-dot {statusClass(dep.status)}"></span>
									<span class="deploy-sha mono"></span>
									<span class="deploy-status">
										{deployLabel(dep.status)}
										{#if dep.triggerType === 'rollback'}
											<span class="badge-md badge-accent">Rollback</span>
										{/if}
									</span>
									<span class="deploy-time mono">{timeAgo(dep.createdAt)}</span>
									<span class="deploy-actions">
										<span class="deploy-duration mono">{duration(dep.createdAt, dep.finishedAt)}</span>
									</span>
								</a>
							</li>
						{/each}
					{/if}
				{/if}
			{/each}
		</ul>
	{/if}
</section>

<style>
	/* Filter bar */
	.filter-bar {
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.filter-btn {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: none;
		border-right: 1.5px solid var(--color-border);
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.filter-btn:last-child {
		border-right: none;
	}
	.filter-btn:hover {
		color: var(--color-text-0);
		background: var(--color-bg-2);
	}
	.filter-active {
		color: var(--color-text-0);
		background: var(--color-bg-2);
	}

	/* Deploy groups */
	.deploy-group-header {
		cursor: pointer;
		border: none;
	}
	.deploy-nested {
		padding-left: var(--space-5);
		background: var(--color-bg-1);
	}
	.expand-icon {
		color: var(--color-text-2);
		font-size: .875rem;
	}
</style>
