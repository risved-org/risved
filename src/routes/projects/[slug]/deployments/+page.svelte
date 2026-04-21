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

	function statusClass(status: string): string {
		if (status === 'live') return 'dot-live'
		if (status === 'failed') return 'dot-failed'
		if (status === 'building') return 'dot-building'
		return 'dot-stopped'
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

<section data-testid="deployments-full">
	<div class="section-header">
		<h2 class="section-title">All Deployments</h2>
		<div class="filter-bar" data-testid="status-filter">
			{#each ['all', 'succeeded', 'failed'] as f (f)}
				<button
					class="filter-btn"
					class:filter-active={statusFilter === f}
					onclick={() => (statusFilter = f)}
				>
					{f === 'all' ? 'All' : f === 'succeeded' ? 'Succeeded' : 'Failed'}
				</button>
			{/each}
		</div>
	</div>

	{#if filtered.length === 0}
		<p class="empty-text">No deployments match the filter.</p>
	{:else}
		<div class="deploy-list">
			{#each groups as group (group.sha ?? group.items[0].id)}
				{#if group.items.length === 1}
					{@const dep = group.items[0]}
					<a
						href={resolve(`/projects/${data.project.slug}/deployments/${dep.id}`)}
						class="deploy-row"
						data-testid="deploy-row"
					>
						<span class="status-dot {statusClass(dep.status)}"></span>
						<span class="deploy-sha mono">{dep.commitSha?.slice(0, 7) ?? '–'}</span>
						<span class="deploy-status">
							{dep.status === 'live' ? 'success' : dep.status}
							{#if dep.triggerType === 'rollback'}
								<span class="trigger-badge">rollback</span>
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
				{:else}
					{@const failCount = group.items.filter((d) => d.status === 'failed').length}
					{@const successCount = group.items.filter((d) => d.status === 'live').length}
					{@const latest = group.items[0]}
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
								<span class="group-count group-failed">{failCount} failed</span>
							{/if}
							{#if successCount > 0}
								<span class="group-count group-succeeded">{successCount} succeeded</span>
							{/if}
						</span>
						<span class="deploy-time mono">{timeAgo(latest.createdAt)}</span>
						<span class="deploy-actions">
							<span class="expand-icon">{expandedSha === group.sha ? '▾' : '▸'}</span>
						</span>
					</button>
					{#if expandedSha === group.sha}
						{#each group.items as dep (dep.id)}
							<a
								href={resolve(`/projects/${data.project.slug}/deployments/${dep.id}`)}
								class="deploy-row deploy-nested"
								data-testid="deploy-row-nested"
							>
								<span class="status-dot {statusClass(dep.status)}"></span>
								<span class="deploy-sha mono"></span>
								<span class="deploy-status">
									{dep.status === 'live' ? 'success' : dep.status}
									{#if dep.triggerType === 'rollback'}
										<span class="trigger-badge">rollback</span>
									{/if}
								</span>
								<span class="deploy-time mono">{timeAgo(dep.createdAt)}</span>
								<span class="deploy-actions">
									<span class="deploy-duration mono">{duration(dep.createdAt, dep.finishedAt)}</span>
								</span>
							</a>
						{/each}
					{/if}
				{/if}
			{/each}
		</div>
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
	.group-count {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: .75rem;
		font-weight: 600;
	}
	.group-failed {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}
	.group-succeeded {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}
	.expand-icon {
		color: var(--color-text-2);
		font-size: .875rem;
	}
</style>
