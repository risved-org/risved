<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation'
	import { resolve } from '$app/paths'
	import TimeAgo from '$lib/components/TimeAgo.svelte'

	let { data } = $props()

	function statusClass(status: string): string {
		if (status === 'live') return 'status-live'
		if (status === 'failed') return 'status-failed'
		if (status === 'building') return 'status-building'
		return 'status-stopped'
	}

	function statusLabel(status: string): string {
		if (status === 'live') return 'Live'
		if (status === 'failed') return 'Failed'
		if (status === 'building') return 'Building'
		if (status === 'cloning') return 'Cloning'
		if (status === 'detecting') return 'Detecting'
		if (status === 'starting') return 'Starting'
		return 'Stopped'
	}

	async function handleRedeploy(e: MouseEvent, project: { id: string; slug: string }) {
		e.preventDefault()
		e.stopPropagation()
		const res = await fetch(`/api/projects/${project.id}/deploy`, { method: 'POST' })
		if (res.ok) {
			const { deploymentId } = await res.json()
			if (deploymentId) {
				await goto(resolve(`/projects/${project.slug}/deployments/${deploymentId}`))
				return
			}
		}
		await invalidateAll()
	}
</script>

<svelte:head>
	<title>Projects – Risved</title>
</svelte:head>

<article class="projects-page">
	<header class="page-header">
		<h1>Projects</h1>
		<a href={resolve('/new')} class="btn-secondary btn-sm">New project</a>
	</header>

	{#if data.projects.length === 0}
		<section class="empty-state" data-testid="empty-state">
			<p class="empty-message">Nothing deployed yet. Connect a repo to get started.</p>
			<a href={resolve('/new')} class="btn-primary">New Project</a>
		</section>
	{:else}
		<section class="project-grid" data-testid="project-grid">
			{#each data.projects as project (project.id)}
				<a
					class="project-card"
					href={resolve(`/projects/${project.slug}`)}
					data-testid="project-card"
				>
					<header class="card-header">
						<span class="card-name">
							<span class="status-dot {statusClass(project.status)}" title={project.status}></span>
							{project.name}
						</span>
						<span class="card-actions">
							<button
								class="action-btn"
								title="Redeploy"
								onclick={(e) => handleRedeploy(e, project)}
								aria-label="Redeploy {project.name}"
							>
								↻
							</button>
							{#if project.domain}
								<a
									class="action-btn"
									href="https://{project.domain}"
									target="_blank"
									rel="noopener"
									aria-label="Open {project.domain}"
									onclick={(e) => e.stopPropagation()}
								>
									↗
								</a>
							{/if}
						</span>
					</header>

					<span class="card-meta">
						{#if project.framework}
							<span class="framework-badge">{project.framework}</span>
						{/if}
						{#if project.status === 'live' && project.containerHealthy === true}
							<span class="health-badge health-ok">Healthy</span>
						{:else if project.status === 'live' && project.containerHealthy === false}
							<span class="health-badge health-failing">Unhealthy</span>
						{:else}
							<span class="health-badge health-na">{statusLabel(project.status)}</span>
						{/if}
						{#if project.totalRestarts > 0}
							<span class="restart-count" title="{project.totalRestarts} restart(s)">{project.totalRestarts}x restarts</span>
						{/if}
					</span>

					<footer class="card-footer">
						{#if project.domain}
							<span class="card-domain mono">{project.domain}</span>
						{/if}
						<span class="card-deploy mono">
							{#if project.commitSha}
								{project.commitSha.slice(0, 7)}
								&middot;
							{/if}
							{#if project.lastDeployedAt}
								<TimeAgo value={project.lastDeployedAt} />
							{:else}
								No deploys
							{/if}
						</span>
					</footer>
				</a>
			{/each}
		</section>
	{/if}
</article>

<style>
	.projects-page {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: var(--space-4);
		gap: var(--space-4);
		max-width: 64rem;
		margin: 0 auto;
		width: 100%;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h1 {
		font-size: 2rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	.btn-sm {
		font-size: .875rem;
		padding: var(--space-1) var(--space-2);
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
		font-size: 1rem;
	}

	/* Card grid */
	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}

	.project-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s, background 0.15s;
	}

	.project-card:hover {
		border-color: var(--color-text-2);
		background: var(--color-bg-2);
		text-decoration: none;
	}

	/* Card header: name + actions */
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

	.card-actions {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	/* Meta row: framework + health */
	.card-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	/* Footer: domain + deploy info */
	.card-footer {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: auto;
	}

	.card-domain {
		font-size: .8125rem;
		color: var(--color-text-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-deploy {
		font-size: .75rem;
		color: var(--color-text-2);
	}

	/* Status dot */
	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
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

	/* Badges */
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

	/* Actions */
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
		font-size: .875rem;
		text-decoration: none;
		transition: all 0.1s;
	}

	.action-btn:hover {
		background: var(--color-bg-3);
		color: var(--color-text-0);
		text-decoration: none;
	}
</style>
