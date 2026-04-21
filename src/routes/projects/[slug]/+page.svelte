<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation'
	import { resolve } from '$app/paths'
	import LineChart from '$lib/components/LineChart.svelte'
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

	function statusClass(status: string): string {
		if (status === 'live') return 'dot-live'
		if (status === 'failed') return 'dot-failed'
		if (status === 'building') return 'dot-building'
		return 'dot-stopped'
	}

	function formatHour(iso: string): string {
		const d = new Date(iso)
		return `${d.getHours().toString().padStart(2, '0')}:00`
	}

	let cpuPoints = $derived(
		data.resourceMetrics.map((m) => ({ label: formatHour(m.bucket), value: m.cpuPercent }))
	)
	let memPoints = $derived(
		data.resourceMetrics.map((m) => ({ label: formatHour(m.bucket), value: m.memoryMb }))
	)

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

<!-- Deployments (last 10) -->
<section data-testid="deployments-section">
	<div class="section-header">
		<h2 class="section-title">Deployments</h2>
		<div class="section-actions">
			<button class="btn-sm" onclick={handleRedeploy} data-testid="redeploy-btn">Redeploy</button>
			<a href={resolve(`/projects/${data.project.slug}/deployments`)} class="btn-sm">View all →</a>
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
						{dep.status === 'live' ? 'success' : dep.status}
						{#if dep.triggerType === 'rollback'}
							<span class="trigger-badge" data-testid="rollback-badge">rollback</span>
						{/if}
						{#if dep.status === 'live' && i === data.deployments.findIndex((d) => d.status === 'live')}
							<span class="current-badge">current</span>
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

<!-- Container Health -->
<section data-testid="health-section">
	<h2 class="section-title">Container Health</h2>
	{#if data.containerHealth}
		<div class="health-card">
			<div class="health-status-row">
				<span class="status-dot {data.containerHealth.healthy ? 'dot-live' : 'dot-failed'}"></span>
				<span class="health-status-text" data-testid="health-status">
					{data.containerHealth.healthy ? 'Healthy' : 'Unhealthy'}
				</span>
				{#if data.containerHealth.lastCheckAt}
					<span class="muted">– Last check {timeAgo(data.containerHealth.lastCheckAt)}</span>
				{/if}
			</div>
			<div class="health-meta">
				<span class="health-meta-item">
					Failures: <strong>{data.containerHealth.consecutiveFailures}</strong>
				</span>
				<span class="health-meta-item">
					Restarts: <strong data-testid="restart-count">{data.containerHealth.totalRestarts}</strong>
				</span>
				{#if data.containerHealth.lastRestartAt}
					<span class="health-meta-item">
						Last restart: <strong>{timeAgo(data.containerHealth.lastRestartAt)}</strong>
					</span>
				{/if}
			</div>
		</div>
	{:else}
		<p class="empty-text">No health data yet. Monitoring starts after deployment goes live.</p>
	{/if}
	{#if data.healthEvents.length > 0}
		<div class="health-events" data-testid="health-events">
			{#each data.healthEvents as evt (evt.id)}
				<div class="health-event-row">
					<span class="event-badge event-{evt.event}">{evt.event.replace('_', ' ')}</span>
					<span class="event-msg">{evt.message}</span>
					<span class="event-time mono">{timeAgo(evt.createdAt)}</span>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- Resource Sparkline (24h) -->
<section data-testid="resource-section">
	<h2 class="section-title">Resource history (24h)</h2>
	<div class="charts-grid">
		<LineChart points={cpuPoints} label="CPU %" color="var(--color-accent)" unit="%" />
		<LineChart points={memPoints} label="Memory (MB)" color="var(--color-live)" unit="MB" />
	</div>
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
	/* Health */
	.health-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: .875rem;
	}
	.health-status-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.health-status-text {
		font-weight: 500;
	}
	.health-meta {
		display: flex;
		gap: var(--space-4);
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.health-meta-item strong {
		color: var(--color-text-0);
	}
	.health-events {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.health-event-row {
		display: grid;
		grid-template-columns: 90px 1fr auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
	}
	.health-event-row:last-child {
		border-bottom: none;
	}
	.event-badge {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.event-check_failed {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}
	.event-restarted {
		background: color-mix(in srgb, var(--color-building) 15%, transparent);
		color: var(--color-building);
	}
	.event-recovered {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}
	.event-msg {
		color: var(--color-text-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.event-time {
		color: var(--color-text-2);
		white-space: nowrap;
	}

</style>
