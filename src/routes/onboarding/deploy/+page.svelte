<script lang="ts">
	import { enhance } from '$app/forms'
	import { resolve } from '$app/paths'
	import type { ActionData, PageData } from './$types'
	import StepIndicator from '../StepIndicator.svelte'

	let { form, data }: { form: ActionData; data: PageData } = $props()

	type DeployPath = 'starter' | 'provider' | 'manual'

	let path = $state<DeployPath>('starter')
	let selectedTemplate = $state<string | null>(null)
	let repoUrl = $state(form?.repoUrl ?? '')
	let branch = $state(form?.branch ?? 'main')
	let submitting = $state(false)

	/* Provider tab state */
	let selectedConnectionId = $state(data.connections[0]?.id ?? '')
	let searchQuery = $state('')
	let searching = $state(false)
	let repos = $state<Repo[]>([])
	let selectedRepo = $state<Repo | null>(null)

	interface Repo {
		id: number
		fullName: string
		name: string
		owner: string
		private: boolean
		defaultBranch: string
		htmlUrl: string
		cloneUrl: string
		description: string | null
		language: string | null
		updatedAt: string
	}

	const selectedConnection = $derived(data.connections.find((c) => c.id === selectedConnectionId))

	const providerLabel: Record<string, string> = {
		github: 'GitHub',
		gitlab: 'GitLab',
		forgejo: 'Forgejo'
	}

	async function loadRepos() {
		if (!selectedConnectionId) return
		searching = true
		try {
			const provider = selectedConnection?.provider ?? 'github'
			const params = new URLSearchParams({ connectionId: selectedConnectionId })
			if (searchQuery.trim()) params.set('search', searchQuery.trim())

			const res = await fetch(`/api/git/${provider}/repos?${params}`)
			if (res.ok) {
				repos = await res.json()
			}
		} finally {
			searching = false
		}
	}

	function selectRepo(repo: Repo) {
		selectedRepo = repo
		repoUrl = repo.cloneUrl
		branch = repo.defaultBranch
	}

	function clearSelection() {
		selectedRepo = null
		repoUrl = ''
		branch = 'main'
	}

	function formatDate(iso: string): string {
		const d = new Date(iso)
		const now = new Date()
		const diff = now.getTime() - d.getTime()
		const days = Math.floor(diff / 86400000)
		if (days === 0) return 'today'
		if (days === 1) return 'yesterday'
		if (days < 30) return `${days}d ago`
		return d.toLocaleDateString()
	}

	$effect(() => {
		if (selectedConnectionId && path === 'provider') {
			loadRepos()
		}
	})

	const canSubmitStarter = $derived(path === 'starter' && !!selectedTemplate)
	const canSubmitRepo = $derived((path === 'provider' || path === 'manual') && !!repoUrl.trim())
</script>

<svelte:head>
	<title>First deploy – Risved</title>
</svelte:head>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={4} skipVerify={data.domainMode === 'ip'} />

		<header>
			<h1>Deploy your first app</h1>
			<p class="subtitle">
				Choose a starter template to verify your setup, or deploy from your own repository.
			</p>
		</header>

		<nav class="tab-bar">
			<button
				type="button"
				class="tab"
				class:active={path === 'starter'}
				onclick={() => (path = 'starter')}
			>
				<span>Starter template</span>
			</button>
			<button
				type="button"
				class="tab"
				class:active={path === 'provider'}
				onclick={() => (path = 'provider')}
			>
				<span>Git provider</span>
			</button>
			<button
				type="button"
				class="tab"
				class:active={path === 'manual'}
				onclick={() => (path = 'manual')}
			>
				<span>Git manually</span>
			</button>
		</nav>

		{#if path === 'starter'}
			<form
				method="post"
				action="?/starter"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
			>
				<input type="hidden" name="templateId" value={selectedTemplate ?? ''} />

				<div class="template-grid">
					{#each data.templates as template (template.id)}
						<button
							type="button"
							class="template-card"
							class:selected={selectedTemplate === template.id}
							onclick={() => (selectedTemplate = selectedTemplate === template.id ? null : template.id)}
						>
							<div class="template-header">
								<span class="template-name">{template.name}</span>
								<span class="template-time">{template.estimatedTime}</span>
							</div>
							<p class="template-desc">{template.description}</p>
						</button>
					{/each}
				</div>

				{#if form?.error && path === 'starter'}
					<p class="form-error" role="alert">{form.error}</p>
				{/if}

				<div class="deploy-actions">
					<button type="submit" class="btn-primary" disabled={submitting || !canSubmitStarter}>
						{submitting ? 'Deploying…' : 'Deploy starter'}
					</button>
					<button type="submit" formaction="?/skip" class="btn-secondary">Skip for now</button>
				</div>
			</form>
		{:else if path === 'provider'}
			{#if data.connections.length === 0}
				<div class="provider-empty">
					<p>No git providers connected yet.</p>
					<a href={resolve('/onboarding/git')} class="btn-connect">Connect a provider</a>
				</div>
				<div class="deploy-actions standalone">
					<form method="post" action="?/skip">
						<button type="submit" class="btn-secondary">Skip for now</button>
					</form>
				</div>
			{:else}
				<form
					method="post"
					action="?/repo"
					use:enhance={() => {
						submitting = true
						return async ({ update }) => {
							submitting = false
							await update()
						}
					}}
				>
					<div class="provider-fields">
						<label class="field">
							<span>Account</span>
							<select bind:value={selectedConnectionId} class="form-select">
								{#each data.connections as conn (conn.id)}
									<option value={conn.id}>
										{conn.accountName} ({providerLabel[conn.provider] ?? conn.provider})
									</option>
								{/each}
							</select>
						</label>

						<label class="field">
							<span>Search repositories</span>
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Filter repositories…"
								oninput={() => loadRepos()}
							/>
						</label>

						{#if searching}
							<p class="search-status">Loading repositories…</p>
						{:else if repos.length === 0 && selectedConnectionId}
							<p class="search-status">No repositories found.</p>
						{:else}
							<div class="repo-list">
								{#each repos as repo (repo.id)}
									<button
										type="button"
										class="repo-row"
										class:selected={selectedRepo?.id === repo.id}
										onclick={() => selectRepo(repo)}
									>
										<div class="repo-info">
											<span class="repo-name">{repo.fullName}</span>
											{#if repo.description}
												<span class="repo-desc">{repo.description}</span>
											{/if}
										</div>
										<div class="repo-meta">
											{#if repo.language}
												<span class="repo-lang">{repo.language}</span>
											{/if}
											<span class="repo-date">{formatDate(repo.updatedAt)}</span>
											{#if repo.private}
												<span class="repo-private">private</span>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						{/if}

						{#if selectedRepo}
							<div class="selected-banner">
								<span class="selected-name">{selectedRepo.fullName}</span>
								<button type="button" class="btn-clear" onclick={clearSelection}>Clear</button>
							</div>
						{/if}
					</div>

					<input type="hidden" name="repoUrl" value={repoUrl} />
					<input type="hidden" name="branch" value={branch} />

					{#if form?.error && path === 'provider'}
						<p class="form-error" role="alert">{form.error}</p>
					{/if}

					<div class="deploy-actions">
						<button type="submit" class="btn-primary" disabled={submitting || !canSubmitRepo}>
							{submitting ? 'Deploying…' : 'Deploy'}
						</button>
						<button type="submit" formaction="?/skip" class="btn-secondary">Skip for now</button>
					</div>
				</form>
			{/if}
		{:else}
			<form
				method="post"
				action="?/repo"
				use:enhance={() => {
					submitting = true
					return async ({ update }) => {
						submitting = false
						await update()
					}
				}}
			>
				<div class="repo-fields">
					<div class="field">
						<label for="repoUrl">Git repository URL</label>
						<input
							id="repoUrl"
							name="repoUrl"
							type="text"
							bind:value={repoUrl}
							placeholder="https://github.com/user/repo.git"
						/>
					</div>
					<div class="field">
						<label for="branch">Branch</label>
						<input id="branch" name="branch" type="text" bind:value={branch} placeholder="main" />
					</div>
				</div>

				{#if form?.error && path === 'manual'}
					<p class="form-error" role="alert">{form.error}</p>
				{/if}

				<div class="deploy-actions">
					<button type="submit" class="btn-primary" disabled={submitting || !canSubmitRepo}>
						{submitting ? 'Deploying…' : 'Deploy from repo'}
					</button>
					<button type="submit" formaction="?/skip" class="btn-secondary">Skip for now</button>
				</div>
			</form>
		{/if}
	</div>
</div>

<style>
	.onboarding-card {
		width: 100%;
		max-width: 560px;
	}

	header {
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: 2rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Tab bar (segmented control) */
	.tab-bar {
		display: inline-flex;
		align-self: flex-start;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: var(--space-4);
	}

	.tab {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-right: 1.5px solid var(--color-border);
		font-size: .875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.tab span {
		color: var(--color-text-0);
		opacity: 0.5;
		transition: opacity 0.15s;
	}

	.tab:last-child {
		border-right: none;
	}

	.tab:hover:not(.active) span {
		opacity: 0.75;
	}

	.tab.active {
		background: var(--color-bg-2);
	}

	.tab.active span {
		opacity: 0.75;
	}

	/* Template grid */
	.template-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.template-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		text-align: left;
		color: var(--color-text-0);
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.template-card:hover {
		border-color: var(--color-text-2);
	}

	.template-card.selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
	}

	.template-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.template-name {
		font-weight: 600;
		font-size: 1rem;
	}

	.template-time {
		font-family: var(--font-mono);
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.template-desc {
		font-size: .875rem;
		color: var(--color-text-1);
		line-height: 1.4;
	}

	/* Repo fields */
	.repo-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	label {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input[type='text'] {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 1rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	input[type='text']::placeholder {
		color: var(--color-text-2);
	}

	input[type='text']:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	/* Provider tab */
	.provider-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-2);
		font-size: .875rem;
	}

	.provider-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.provider-fields .field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.provider-fields .field span {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	.form-select {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 1rem;
		outline: none;
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.form-select:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.search-status {
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.repo-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		max-height: 280px;
		overflow-y: auto;
	}

	.repo-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.repo-row:last-child {
		border-bottom: none;
	}

	.repo-row:hover {
		background: var(--color-bg-2);
	}

	.repo-row.selected {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.repo-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.repo-name {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-0);
	}

	.repo-desc {
		font-size: .75rem;
		color: var(--color-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.repo-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		font-size: .75rem;
		color: var(--color-text-2);
	}

	.repo-private {
		padding: 1px var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: .625rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.selected-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.selected-name {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-0);
	}

	.btn-clear {
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: .75rem;
		cursor: pointer;
	}

	.btn-clear:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	.deploy-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.deploy-actions.standalone {
		margin-top: var(--space-5);
	}

	.deploy-actions form {
		display: contents;
	}

	.btn-connect {
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.btn-connect:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

</style>
