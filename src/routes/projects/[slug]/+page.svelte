<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation'
	import { resolve } from '$app/paths'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

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

	function projectStatusLabel(status: string): string {
		if (status === 'live') return 'Live'
		return deployLabel(status)
	}

	let rollingBack = $state<string | null>(null)

	async function handleRedeploy() {
		const res = await fetch(`/api/projects/${data.project.id}/deploy`, { method: 'POST' })
		if (res.ok) {
			const { deploymentId } = await res.json()
			if (deploymentId) {
				await goto(resolve(`/projects/${data.project.slug}/deployments/${deploymentId}`))
			} else {
				await invalidateAll()
			}
		}
	}

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

<h1 class="page-title">Overview</h1>

<!-- Project info card -->
<section class="project-info-card" data-testid="project-info">
	<header class="card-header">
		<span class="card-name">{data.project.name}</span>
	</header>

	<div class="card-meta">
		{#if data.project.framework}
			<span class="framework-badge">{data.project.framework}</span>
		{/if}
		{#if data.project.status === 'live' && data.containerHealth?.healthy === true}
			<span class="health-badge health-ok">Healthy</span>
		{:else if data.project.status === 'live' && data.containerHealth?.healthy === false}
			<span class="health-badge health-failing">Unhealthy</span>
		{:else}
			<span class="health-badge health-na">{projectStatusLabel(data.project.status)}</span>
		{/if}
		{#if data.containerHealth && data.containerHealth.totalRestarts > 0}
			<span class="restart-count">{data.containerHealth.totalRestarts}x restarts</span>
		{/if}
	</div>

	{#if data.project.domains.length > 0}
		<footer class="card-footer">
			{#each data.project.domains as dom (dom.id)}
				<a
					class="card-domain mono"
					href="https://{dom.hostname}"
					target="_blank"
					rel="noopener"
				>
					{dom.hostname}
				</a>
			{/each}
		</footer>
	{/if}
</section>

<!-- Deployments (last 5) -->
<section data-testid="deployments-section">
	<div class="section-header">
		<h2 class="section-title">Deployments</h2>
		<div class="section-actions">
			<button class="btn-secondary btn-md" onclick={handleRedeploy} data-testid="redeploy-btn">Redeploy</button>
			<a href={resolve(`/projects/${data.project.slug}/deployments`)} class="btn-secondary btn-md">View all</a>
		</div>
	</div>
	{#if data.deployments.length === 0}
		<p class="empty-text">No deployments yet.</p>
	{:else}
		<div class="deploy-list">
			{#each data.deployments as dep, i (dep.id)}
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
							<span class="trigger-badge" data-testid="rollback-badge">Rollback</span>
						{/if}
						{#if dep.status === 'live' && i === data.deployments.findIndex((d) => d.status === 'live')}
							<span class="current-badge">Current</span>
						{/if}
					</span>
					<span class="deploy-time mono">{timeAgo(dep.createdAt)}</span>
					<span class="deploy-actions">
						{#if i > 0 && (dep.status === 'live' || dep.status === 'stopped') && dep.imageTag}
							<button
								class="btn-rollback"
								data-testid="rollback-btn"
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
			{/each}
		</div>
	{/if}
</section>

<style>
	.section-actions {
		display: flex;
		gap: var(--space-2);
	}

	.current-badge {
		padding: 1px 6px;
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
		border-radius: var(--radius-sm);
		font-size: .75rem;
		font-weight: 600;
		letter-spacing: 0.03em;
	}

	/* Project info card — mirrors dashboard project-card */
	.project-info-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.card-name {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.card-footer {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.card-domain {
		font-size: .875rem;
		color: var(--color-accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-domain:hover {
		text-decoration: underline;
	}

	.framework-badge {
		display: inline-block;
		padding: 1px 6px;
		background: var(--color-bg-3);
		border-radius: var(--radius-sm);
		font-size: .75rem;
		color: var(--color-text-1);
	}

	.health-badge {
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		font-size: .75rem;
		font-weight: 500;
		letter-spacing: 0.03em;
	}

	.health-ok {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}

	.health-failing {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}

	.health-na {
		color: var(--color-text-2);
	}

	.restart-count {
		color: var(--color-building);
		font-size: .75rem;
	}
</style>
