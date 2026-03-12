<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let { data } = $props();

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return '—';
		const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function statusClass(status: string): string {
		if (status === 'live') return 'status-live';
		if (status === 'failed') return 'status-failed';
		if (status === 'building') return 'status-building';
		return 'status-stopped';
	}

	function handleRedeploy(e: MouseEvent, projectId: string) {
		e.stopPropagation();
		fetch(`/api/projects/${projectId}/deploy`, { method: 'POST' });
	}
</script>

<svelte:head>
	<title>Dashboard — Risved</title>
</svelte:head>

<div class="dashboard">
	<!-- Health bar -->
	<div class="health-bar" data-testid="health-bar">
		<div class="health-item">
			<span class="health-label">CPU</span>
			<span class="health-value" data-testid="cpu-value">{data.health.cpuPercent}%</span>
		</div>
		<div class="health-item">
			<span class="health-label">MEM</span>
			<span class="health-value" data-testid="mem-value">{data.health.memoryPercent}%</span>
		</div>
		<div class="health-item">
			<span class="health-label">DISK</span>
			<span class="health-value" data-testid="disk-value">{data.health.diskPercent}%</span>
		</div>
		<div class="health-item">
			<span class="health-label">UPTIME</span>
			<span class="health-value" data-testid="uptime-value">{data.health.uptime}</span>
		</div>
		<div class="health-item">
			<span class="health-label">CONTAINERS</span>
			<span class="health-value" data-testid="container-value">{data.health.containerCount}</span>
		</div>
	</div>

	<!-- Project list -->
	{#if data.projects.length === 0}
		<div class="empty-state" data-testid="empty-state">
			<p class="empty-message">No projects yet. Deploy your first app to get started.</p>
			<a href={resolve('/new')} class="btn-primary">New Project</a>
		</div>
	{:else}
		<div class="project-table" data-testid="project-table">
			<div class="table-header">
				<span class="col-status"></span>
				<span class="col-name">Project</span>
				<span class="col-framework">Framework</span>
				<span class="col-domain">Domain</span>
				<span class="col-commit">Commit</span>
				<span class="col-time">Deployed</span>
				<span class="col-health">Health</span>
				<span class="col-actions"></span>
			</div>

			{#each data.projects as project (project.id)}
				<div
					class="table-row"
					data-testid="project-row"
					role="button"
					tabindex="0"
					onclick={() => goto(resolve(`/projects/${project.slug}`))}
					onkeydown={(e) => e.key === 'Enter' && goto(resolve(`/projects/${project.slug}`))}
				>
					<span class="col-status">
						<span class="status-dot {statusClass(project.status)}" title={project.status}></span>
					</span>
					<span class="col-name">{project.name}</span>
					<span class="col-framework">
						{#if project.framework}
							<span class="framework-badge">{project.framework}</span>
						{/if}
					</span>
					<span class="col-domain mono">
						{#if project.domain}
							<a
								href="https://{project.domain}"
								target="_blank"
								rel="noopener"
								onclick={(e) => e.stopPropagation()}
							>
								{project.domain}
							</a>
						{:else}
							<span class="muted">—</span>
						{/if}
					</span>
					<span class="col-commit mono">
						{#if project.commitSha}
							{project.commitSha.slice(0, 7)}
						{:else}
							<span class="muted">—</span>
						{/if}
					</span>
					<span class="col-time mono">{timeAgo(project.lastDeployedAt)}</span>
					<span class="col-health" data-testid="health-indicator">
						{#if project.status === 'live' && project.containerHealthy === true}
							<span class="health-badge health-ok" title="Healthy">OK</span>
						{:else if project.status === 'live' && project.containerHealthy === false}
							<span class="health-badge health-failing" title="Unhealthy">FAIL</span>
						{:else}
							<span class="health-badge health-na">—</span>
						{/if}
						{#if project.totalRestarts > 0}
							<span class="restart-count" title="{project.totalRestarts} restart(s)"
								>{project.totalRestarts}x</span
							>
						{/if}
					</span>
					<span class="col-actions">
						<button
							class="action-btn"
							title="Redeploy"
							onclick={(e) => handleRedeploy(e, project.id)}
						>
							↻
						</button>
						{#if project.domain}
							<a
								class="action-btn"
								href="https://{project.domain}"
								target="_blank"
								rel="noopener"
								title="Open"
								onclick={(e) => e.stopPropagation()}
							>
								↗
							</a>
						{/if}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: var(--space-4);
		gap: var(--space-4);
		max-width: 1200px;
		margin: 0 auto;
		width: 100%;
	}

	/* Health bar — single horizontal strip */
	.health-bar {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.health-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.health-label {
		color: var(--color-text-2);
		font-weight: 500;
		letter-spacing: 0.05em;
	}

	.health-value {
		color: var(--color-text-0);
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		gap: var(--space-4);
		min-height: 300px;
	}

	.empty-message {
		color: var(--color-text-2);
		font-size: 0.9375rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		color: #fff;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
	}

	.btn-primary:hover {
		background: var(--color-accent-dim);
		text-decoration: none;
	}

	/* Project table */
	.project-table {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.table-header,
	.table-row {
		display: grid;
		grid-template-columns: 32px 1.5fr 0.8fr 1.5fr 0.7fr 0.7fr 64px 72px;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		gap: var(--space-2);
		min-height: 40px;
	}

	.table-header {
		background: var(--color-bg-2);
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-bottom: 1px solid var(--color-border);
	}

	.table-row {
		background: var(--color-bg-1);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: background 0.1s;
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.table-row:hover {
		background: var(--color-bg-2);
	}

	/* Status dot */
	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin: 0 auto;
	}

	.status-live {
		background: var(--color-live);
		box-shadow: 0 0 6px var(--color-live);
	}

	.status-failed {
		background: var(--color-failed);
	}

	.status-building {
		background: var(--color-building);
	}

	.status-stopped {
		background: var(--color-stopped);
	}

	/* Column styling */
	.col-status {
		display: flex;
		justify-content: center;
	}

	.col-name {
		font-weight: 500;
		color: var(--color-text-0);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.col-framework {
		white-space: nowrap;
	}

	.framework-badge {
		display: inline-block;
		padding: 1px 6px;
		background: var(--color-bg-3);
		border-radius: var(--radius-sm);
		font-size: 0.6875rem;
		color: var(--color-text-1);
	}

	.col-domain {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.col-commit,
	.col-time {
		white-space: nowrap;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.muted {
		color: var(--color-text-2);
	}

	/* Health column */
	.col-health {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		white-space: nowrap;
		font-size: 0.6875rem;
		font-family: var(--font-mono);
	}

	.health-badge {
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		font-weight: 600;
		letter-spacing: 0.03em;
	}

	.health-ok {
		background: rgba(34, 197, 94, 0.15);
		color: var(--color-live);
	}

	.health-failing {
		background: rgba(239, 68, 68, 0.15);
		color: var(--color-failed);
	}

	.health-na {
		color: var(--color-text-2);
	}

	.restart-count {
		color: var(--color-building);
		font-size: 0.625rem;
	}

	/* Actions */
	.col-actions {
		display: flex;
		gap: var(--space-1);
		justify-content: flex-end;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		cursor: pointer;
		font-size: 0.875rem;
		text-decoration: none;
		transition: all 0.1s;
	}

	.action-btn:hover {
		background: var(--color-bg-3);
		color: var(--color-text-0);
		text-decoration: none;
	}
</style>
