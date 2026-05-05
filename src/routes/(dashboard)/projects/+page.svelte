<script lang="ts">
	import { resolve } from '$app/paths'
	import TimeAgo from '$lib/components/TimeAgo.svelte'

	let { data } = $props()

	function statusLabel(status: string): string {
		if (status === 'live') return 'Live'
		if (status === 'failed') return 'Failed'
		if (status === 'building' || status === 'running') return 'Building'
		if (status === 'cloning') return 'Cloning'
		if (status === 'detecting') return 'Detecting'
		if (status === 'starting') return 'Starting'
		return 'Stopped'
	}
</script>

<svelte:head>
	<title>Projects – Risved</title>
</svelte:head>

<article class="projects-page">
	<header class="page-header">
		<h1>Projects</h1>
		<a href={resolve('/new')} class="btn-secondary btn-md">New project</a>
	</header>

	{#if data.projects.length === 0}
		<section class="empty-state" data-testid="empty-state">
			<p class="empty-message">Nothing deployed yet. Connect a repo to get started.</p>
			<a href={resolve('/new')} class="btn-primary btn-lg">New Project</a>
		</section>
	{:else}
		<section class="project-grid" data-testid="project-grid">
			{#each data.projects as project (project.id)}
				<article class="project-card" data-testid="project-card">
					<a
						class="card-link"
						href={resolve(`/projects/${project.slug}`)}
						aria-label="Open {project.name}"
					></a>

					<header class="card-header">
						<span class="card-name">{project.name}</span>
					</header>

					<span class="card-meta">
						{#if project.framework}
							<span class="badge-sm badge-neutral">{project.framework}</span>
						{/if}
						{#if project.status === 'live' && project.containerHealthy === true}
							<span class="badge-sm badge-live">Healthy</span>
						{:else if project.status === 'live' && project.containerHealthy === false}
							<span class="badge-sm badge-failed">Unhealthy</span>
						{:else}
							<span class="badge-sm badge-muted">{statusLabel(project.status)}</span>
						{/if}
						{#if project.totalRestarts > 0}
							<span class="badge-sm badge-building" title="{project.totalRestarts} restart(s)">{project.totalRestarts}x restarts</span>
						{/if}
					</span>

					<footer class="card-footer">
						{#if project.domain}
							<a
								class="card-domain mono"
								href="https://{project.domain}"
								target="_blank"
								rel="noopener"
							>
								{project.domain}
							</a>
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
				</article>
			{/each}
		</section>
	{/if}
</article>

<style>
	.projects-page {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: var(--space-4) 0;
		gap: var(--space-4);
		width: min(100% - 2rem, 64rem);
		margin: 0 auto;
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
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: inherit;
		transition: border-color 0.15s, background 0.15s;
	}

	.project-card:hover {
		border-color: var(--color-text-2);
		background: var(--color-bg-2);
	}

	.card-link {
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}

	.card-link:hover {
		text-decoration: none;
	}

	.card-header,
	.card-meta,
	.card-footer {
		position: relative;
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
		font-size: .875rem;
		color: var(--color-accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-domain:visited {
		color: var(--color-accent);
	}

	.card-domain:hover {
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		text-underline-offset: 0.25em;
	}

	.card-deploy {
		font-size: .75rem;
		line-height: 1.34;
		color: var(--color-text-2);
	}

</style>
