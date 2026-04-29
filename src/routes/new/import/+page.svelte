<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let selectedConnectionId = $state(data.connections[0]?.id ?? '');
	let searchQuery = $state('');
	let searching = $state(false);
	let repos = $state<Repo[]>([]);
	let selectedRepo = $state<Repo | null>(null);
	let projectName = $state('');
	let branch = $state('');
	let frameworkId = $state('');
	let autoDeploy = $state(true);
	let deploying = $state(false);

	interface Repo {
		id: number;
		fullName: string;
		name: string;
		owner: string;
		private: boolean;
		defaultBranch: string;
		htmlUrl: string;
		cloneUrl: string;
		description: string | null;
		language: string | null;
		updatedAt: string;
	}

	const selectedConnection = $derived(data.connections.find((c) => c.id === selectedConnectionId));

	const providerLabel: Record<string, string> = {
		github: 'GitHub',
		gitlab: 'GitLab',
		forgejo: 'Forgejo'
	};

	async function loadRepos() {
		if (!selectedConnectionId) return;
		searching = true;
		try {
			const provider = selectedConnection?.provider ?? 'github';
			const params = new URLSearchParams({ connectionId: selectedConnectionId });
			if (searchQuery.trim()) params.set('search', searchQuery.trim());

			const res = await fetch(`/api/git/${provider}/repos?${params}`);
			if (res.ok) {
				repos = await res.json();
			}
		} finally {
			searching = false;
		}
	}

	function selectRepo(repo: Repo) {
		selectedRepo = repo;
		projectName = repo.name;
		branch = repo.defaultBranch;
	}

	function clearSelection() {
		selectedRepo = null;
		projectName = '';
		branch = '';
		frameworkId = '';
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		const now = new Date();
		const diff = now.getTime() - d.getTime();
		const days = Math.floor(diff / 86400000);
		if (days === 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days}d ago`;
		return d.toLocaleDateString();
	}

	$effect(() => {
		if (selectedConnectionId) {
			loadRepos();
		}
	});
</script>

<svelte:head>
	<title>Import Repository – Risved</title>
</svelte:head>

<div class="import-page">
	<header class="page-header">
		<a href={resolve('/new')} class="back-link">← New Project</a>
		<h1>Import Repository</h1>
	</header>

	{#if data.connections.length === 0}
		<div class="empty-state" data-testid="no-providers">
			<p>No Git providers connected.</p>
			<a href={resolve('/settings/git')} class="btn-primary">Connect a provider</a>
		</div>
	{:else}
		<!-- Account selector -->
		<section class="section" data-testid="account-selector">
			<h2 class="section-title">Account</h2>
			<select
				class="form-input account-select"
				bind:value={selectedConnectionId}
				data-testid="account-select"
			>
				{#each data.connections as conn (conn.id)}
					<option value={conn.id}>
						{conn.accountName} ({providerLabel[conn.provider] ?? conn.provider})
					</option>
				{/each}
			</select>
		</section>

		<!-- Search -->
		<section class="section" data-testid="search-section">
			<div class="search-row">
				<input
					type="text"
					class="form-input search-input"
					placeholder="Search repositories…"
					bind:value={searchQuery}
					data-testid="repo-search"
				/>
				<button
					class="btn-secondary"
					onclick={loadRepos}
					disabled={searching}
					data-testid="search-btn"
				>
					{searching ? 'Searching…' : 'Search'}
				</button>
			</div>
		</section>

		<!-- Repo list -->
		{#if !selectedRepo}
			<section class="section" data-testid="repo-list">
				<h2 class="section-title">
					Repositories
					{#if searching}
						<span class="loading-hint">Loading…</span>
					{/if}
				</h2>
				{#if repos.length === 0 && !searching}
					<p class="empty-text" data-testid="no-repos">No repositories found.</p>
				{:else}
					<div class="repos">
						{#each repos as repo (repo.id)}
							<button class="repo-row" onclick={() => selectRepo(repo)} data-testid="repo-row">
								<div class="repo-info">
									<span class="repo-name mono">{repo.fullName}</span>
									{#if repo.description}
										<span class="repo-desc">{repo.description}</span>
									{/if}
								</div>
								<div class="repo-meta">
									{#if repo.language}
										<span class="repo-lang">{repo.language}</span>
									{/if}
									<span class="repo-date">{formatDate(repo.updatedAt)}</span>
									<span class="repo-badge" class:private={repo.private}>
										{repo.private ? 'Private' : 'Public'}
									</span>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		<!-- Config panel (after selecting a repo) -->
		{#if selectedRepo}
			<section class="section" data-testid="config-panel">
				<div class="selected-repo-header">
					<div>
						<h2 class="section-title">Configure Import</h2>
						<span class="selected-repo-name mono">{selectedRepo.fullName}</span>
					</div>
					<button
						class="btn-secondary btn-sm"
						onclick={clearSelection}
						data-testid="change-repo-btn"
					>
						Change
					</button>
				</div>

				<form
					method="post"
					use:enhance={() => {
						deploying = true;
						return async ({ update }) => {
							deploying = false;
							await update();
						};
					}}
				>
					<input type="hidden" name="repoUrl" value={selectedRepo.htmlUrl} />
					<input type="hidden" name="cloneUrl" value={selectedRepo.cloneUrl} />
					<input type="hidden" name="connectionId" value={selectedConnectionId} />

					<div class="form-card">
						<div class="form-group">
							<label for="projectName" class="form-label">Project Name</label>
							<input
								type="text"
								id="projectName"
								name="projectName"
								bind:value={projectName}
								class="form-input"
								data-testid="project-name-input"
							/>
						</div>

						<div class="form-group">
							<label for="branch" class="form-label">Branch</label>
							<input
								type="text"
								id="branch"
								name="branch"
								bind:value={branch}
								class="form-input mono"
								data-testid="branch-input"
							/>
						</div>

						<div class="form-group">
							<label for="frameworkId" class="form-label">Framework</label>
							<select
								id="frameworkId"
								name="frameworkId"
								bind:value={frameworkId}
								class="form-input"
								data-testid="framework-select"
							>
								<option value="">Auto-detect</option>
								{#each data.frameworks as fw (fw.id)}
									<option value={fw.id}>{fw.name}</option>
								{/each}
							</select>
						</div>

						<label class="checkbox-row" data-testid="auto-deploy-checkbox">
							<input type="checkbox" bind:checked={autoDeploy} />
							<span>Auto-deploy on push</span>
						</label>

						{#if form?.error}
							<p class="form-error" data-testid="import-error">{form.error}</p>
						{/if}

						<button
							type="submit"
							class="btn-primary btn-deploy"
							disabled={deploying || !projectName}
							data-testid="import-deploy-btn"
						>
							{deploying ? 'Importing…' : 'Import and deploy'}
						</button>
					</div>
				</form>
			</section>
		{/if}
	{/if}
</div>

<style>
	.import-page {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-6);
		max-width: 720px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-5);
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

	h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: var(--space-6) var(--space-4);
		color: var(--color-text-2);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
	}

	/* Account selector */
	.account-select {
		max-width: 360px;
	}

	/* Search */
	.search-row {
		display: flex;
		gap: var(--space-2);
	}
	.search-input {
		flex: 1;
	}

	/* Repo list */
	.repos {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.repo-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-1);
		border: none;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		text-align: left;
		color: var(--color-text-0);
		width: 100%;
		font-size: .875rem;
	}
	.repo-row:last-child {
		border-bottom: none;
	}
	.repo-row:hover {
		background: var(--color-bg-0);
	}
	.repo-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.repo-name {
		font-weight: 500;
		color: var(--color-text-0);
	}
	.repo-desc {
		font-size: .875rem;
		color: var(--color-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.repo-meta {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-shrink: 0;
	}
	.repo-lang {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.repo-date {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.repo-badge {
		font-size: .875rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-text-0) 6%, transparent);
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.repo-badge.private {
		background: color-mix(in srgb, var(--color-failed) 10%, transparent);
		color: var(--color-failed);
	}

	.loading-hint {
		font-weight: 400;
		font-size: .875rem;
		text-transform: none;
		letter-spacing: 0;
		margin-left: var(--space-2);
	}
	/* Config panel */
	.selected-repo-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.selected-repo-name {
		color: var(--color-text-0);
		margin-top: 2px;
		display: block;
	}

	.form-input {
		background: var(--color-bg-0);
		border-width: 1px;
		font-size: .875rem;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: .875rem;
		color: var(--color-text-1);
		cursor: pointer;
	}

	.form-error {
		font-size: .875rem;
		color: var(--color-failed);
	}

	.btn-primary {
		border: 1px solid var(--color-accent);
		color: var(--color-bg-0);
		font-weight: 500;
	}
	.btn-primary:hover:not(:disabled) {
		opacity: 0.9;
		background: var(--color-accent);
	}

	.btn-secondary {
		border-width: 1px;
		font-size: .875rem;
		font-weight: 500;
	}

	.btn-sm {
		padding: var(--space-1) var(--space-2);
		font-size: .875rem;
	}

	.btn-deploy {
		align-self: flex-start;
	}
</style>
