<script lang="ts">
	import { enhance } from '$app/forms'
	import { resolve } from '$app/paths'
	import ProjectScriptsForm from '$lib/components/ProjectScriptsForm.svelte'
	import type { DetectScriptsResult } from '$lib/scripts-detect'
	import type { ActionData, PageData } from './$types'

	let { form, data }: { form: ActionData; data: PageData } = $props()

	let repoUrl = $state(form?.repoUrl ?? '')
	let branch = $state(form?.branch ?? 'main')
	let rootDir = $state(form?.rootDir ?? '/')
	let projectName = $state(form?.projectName ?? '')
	let frameworkId = $state(form?.frameworkId ?? '')
	let buildCommand = $state('')
	let startCommand = $state('')
	let releaseCommand = $state('')
	let detection = $state<DetectScriptsResult | null>(null)
	let submitting = $state(false)

	/* Tab state */
	let activeTab = $state<'provider' | 'url'>(data.connections.length > 0 ? 'provider' : 'url')

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

	async function selectRepo(repo: Repo) {
		selectedRepo = repo
		repoUrl = repo.cloneUrl
		branch = repo.defaultBranch
		projectName = repo.name
		await loadDetection(repo)
	}

	function clearSelection() {
		selectedRepo = null
		repoUrl = ''
		branch = 'main'
		projectName = ''
		frameworkId = ''
		detection = null
	}

	async function loadDetection(repo: Repo) {
		const provider = selectedConnection?.provider ?? 'github'
		const params = new URLSearchParams({
			connectionId: selectedConnectionId,
			owner: repo.owner,
			repo: repo.name,
			branch: repo.defaultBranch
		})
		try {
			const res = await fetch(`/api/git/${provider}/detect-scripts?${params}`)
			if (res.ok) {
				detection = await res.json()
			} else {
				detection = null
			}
		} catch {
			detection = null
		}
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
		if (selectedConnectionId && activeTab === 'provider') {
			loadRepos()
		}
	})

	/* Env vars: array of { key, value, isSecret } */
	let envRows = $state<{ key: string; value: string; isSecret: boolean }[]>([])

	/* Auto-derive project name from repo URL */
	const derivedName = $derived.by(() => {
		if (projectName) return projectName
		if (!repoUrl) return ''
		const cleaned = repoUrl.replace(/\.git$/, '').replace(/\/$/, '')
		const parts = cleaned.split('/')
		return parts[parts.length - 1] || ''
	})

	/* Auto-derive subdomain from project name */
	const derivedDomain = $derived.by(() => {
		const name = derivedName
		if (!name) return ''
		const slug = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 63)
		if (!data.domain) return slug
		return `${slug}.${data.domain}`
	})

	function addEnvRow() {
		envRows = [...envRows, { key: '', value: '', isSecret: false }]
	}

	function removeEnvRow(index: number) {
		envRows = envRows.filter((_, i) => i !== index)
	}

	/** Parse pasted .env content: split KEY=value on the first = sign */
	function handleEnvPaste(event: ClipboardEvent, index: number) {
		const text = event.clipboardData?.getData('text') ?? ''
		if (!text.includes('=')) return

		event.preventDefault()
		const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
		const parsed = lines.map((line) => {
			const eqIndex = line.indexOf('=')
			if (eqIndex === -1) return { key: line.trim(), value: '', isSecret: false }
			return {
				key: line.slice(0, eqIndex).trim(),
				value: line.slice(eqIndex + 1).trim(),
				isSecret: false
			}
		})

		if (parsed.length === 0) return

		/* Replace the current row with the first parsed entry, append the rest */
		const updated = [...envRows]
		updated[index] = { ...updated[index], ...parsed[0] }
		for (let j = 1; j < parsed.length; j++) {
			updated.splice(index + j, 0, parsed[j])
		}
		envRows = updated
	}

	/* Serialize env vars into hidden fields using unit separator */
	const envKeysValue = $derived(envRows.map((r) => r.key).join('\x1F'))
	const envValuesValue = $derived(envRows.map((r) => r.value).join('\x1F'))
	const envSecretsValue = $derived(envRows.map((r) => (r.isSecret ? '1' : '0')).join('\x1F'))

	const canSubmit = $derived(!!repoUrl.trim())
</script>

<svelte:head>
	<title>New project – Risved</title>
</svelte:head>

<article class="new-project">
	<header>
		<a href={resolve('/')} class="back-link" data-testid="back-link">← Back</a>
		<h1>New project</h1>
		<p class="subtitle">Configure and deploy a new project from a git repository.</p>
	</header>

	<form
		method="post"
		use:enhance={() => {
			submitting = true
			return async ({ update }) => {
				submitting = false
				await update()
			}
		}}
	>
		<!-- Git source section -->
		<section class="section" data-testid="git-section">
			<h2 class="section-title">Git source</h2>

			<nav class="tab-bar" data-testid="source-tabs">
				<button
					type="button"
					class="tab"
					class:active={activeTab === 'provider'}
					onclick={() => (activeTab = 'provider')}
					data-testid="tab-provider"
				>
					Git provider
				</button>
				<button
					type="button"
					class="tab"
					class:active={activeTab === 'url'}
					onclick={() => (activeTab = 'url')}
					data-testid="tab-url"
				>
					Manually
				</button>
			</nav>

			{#if activeTab === 'provider'}
				{#if data.connections.length === 0}
					<div class="provider-empty" data-testid="no-providers">
						<a href={resolve('/settings/git')} class="btn-connect" data-testid="connect-provider-link">
							Add a git provider…
						</a>
					</div>
				{:else}
					<fieldset class="section-body">
						<label>Account
							<select
								class="form-input"
								bind:value={selectedConnectionId}
								data-testid="account-select"
							>
								{#each data.connections as conn (conn.id)}
									<option value={conn.id}>
										{conn.accountName} ({providerLabel[conn.provider] ?? conn.provider})
									</option>
								{/each}
							</select>
						</label>

						<label>Search repositories
							<div class="search-row">
								<input
									type="text"
									bind:value={searchQuery}
									placeholder="Filter repositories…"
									oninput={() => loadRepos()}
									data-testid="repo-search"
								/>
							</div>
						</label>

						{#if searching}
							<p class="search-status">Loading repositories…</p>
						{:else if repos.length === 0}
							<p class="search-status">No repositories found.</p>
						{:else}
							<div class="repo-list" data-testid="repo-list">
								{#each repos as repo (repo.id)}
									<button
										type="button"
										class="repo-row"
										class:selected={selectedRepo?.id === repo.id}
										onclick={() => selectRepo(repo)}
										data-testid="repo-row"
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
							<div class="selected-banner" data-testid="selected-repo">
								<span class="selected-name">{selectedRepo.fullName}</span>
								<button type="button" class="btn-clear" onclick={clearSelection}>Clear</button>
							</div>
						{/if}
					</fieldset>
				{/if}
			{:else}
				<fieldset class="section-body">
					<label>Repository URL
						<input
							name="repoUrl"
							type="text"
							bind:value={repoUrl}
							placeholder="https://github.com/user/repo.git"
							required
							data-testid="repo-url-input"
						/>
					</label>
					<div class="field-row">
						<label>Branch
							<input
								name="branch"
								type="text"
								bind:value={branch}
								placeholder="main"
								data-testid="branch-input"
							/>
						</label>
						<label>Root directory
							<input
								name="rootDir"
								type="text"
								bind:value={rootDir}
								placeholder="/"
								data-testid="root-dir-input"
							/>
						</label>
					</div>
				</fieldset>
			{/if}

			<!-- Hidden fields so form always has the values regardless of active tab -->
			{#if activeTab === 'provider'}
				<input type="hidden" name="repoUrl" value={repoUrl} />
				<input type="hidden" name="branch" value={branch} />
				<input type="hidden" name="rootDir" value={rootDir} />
				<input type="hidden" name="connectionId" value={selectedConnectionId} />
			{/if}
		</section>

		<!-- Framework -->
		<section class="section" data-testid="detection-section">
			<h2 class="section-title">Framework</h2>
			<fieldset class="section-body">
				<label>Framework override
					<select
						name="frameworkId"
						bind:value={frameworkId}
						data-testid="framework-select"
					>
						<option value="">Auto-detect</option>
						{#each data.frameworks as fw (fw.id)}
							<option value={fw.id}>{fw.name}</option>
						{/each}
					</select>
				</label>
			</fieldset>
		</section>

		<!-- Scripts: build, start, release -->
		<section class="section" data-testid="scripts-section">
			<h2 class="section-title">How do we run your code</h2>
			<ProjectScriptsForm
				bind:buildCommand
				bind:startCommand
				bind:releaseCommand
				{detection}
			/>
		</section>

		<!-- Configuration -->
		<section class="section" data-testid="config-section">
			<h2 class="section-title">Configuration</h2>
			<fieldset class="section-body">
				<label>Project name
					<input
						name="projectName"
						type="text"
						bind:value={projectName}
						placeholder={derivedName || 'my-project'}
						data-testid="project-name-input"
					/>
					<span class="field-hint">Auto-generated from repository name if left blank</span>
				</label>
				<label>Domain
					<output class="domain-preview mono" data-testid="domain-preview">
						{derivedDomain || '–'}
					</output>
				</label>
			</fieldset>
		</section>

		<!-- Environment variables -->
		<section class="section" data-testid="env-section">
			<h2 class="section-title">Environment variables</h2>
			<fieldset class="env-editor">
				{#each envRows as row, i (i)}
					<div class="env-row" data-testid="env-row">
						<input
							class="env-key"
							type="text"
							bind:value={row.key}
							placeholder="KEY"
							onpaste={(e) => handleEnvPaste(e, i)}
							data-testid="env-key-input"
						/>
						<span class="env-eq">=</span>
						{#if row.isSecret}
							<input
								class="env-value secret"
								type="password"
								bind:value={row.value}
								placeholder="value"
								data-testid="env-value-input"
							/>
						{:else}
							<input
								class="env-value"
								type="text"
								bind:value={row.value}
								placeholder="value"
								data-testid="env-value-input"
							/>
						{/if}
						<button
							type="button"
							class="env-secret-toggle"
							class:active={row.isSecret}
							title={row.isSecret ? 'Unmark as secret' : 'Mark as secret'}
							onclick={() => (row.isSecret = !row.isSecret)}
							data-testid="env-secret-toggle"
						>
							{row.isSecret ? '🔒' : '🔓'}
						</button>
						<button
							type="button"
							class="env-remove"
							title="Remove variable"
							onclick={() => removeEnvRow(i)}
							data-testid="env-remove-btn"
						>
							×
						</button>
					</div>
				{/each}
				{#if envRows.length === 0}
					<p class="env-empty">No environment variables configured.</p>
				{/if}
				<button type="button" class="env-add" onclick={addEnvRow} data-testid="env-add-btn">
					+ Add variable
				</button>
			</fieldset>

			<input type="hidden" name="envKeys" value={envKeysValue} />
			<input type="hidden" name="envValues" value={envValuesValue} />
			<input type="hidden" name="envSecrets" value={envSecretsValue} />
		</section>

		{#if form?.error}
			<p class="form-error" role="alert" data-testid="form-error">{form.error}</p>
		{/if}

		<button
			type="submit"
			class="btn-deploy"
			disabled={submitting || !canSubmit}
			data-testid="deploy-btn"
		>
			{submitting ? 'Deploying…' : 'Deploy project'}
		</button>
	</form>
</article>

<style>
	.new-project {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-8);
		max-width: 680px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-4);
	}

	header {
		margin-bottom: var(--space-2);
	}

	.back-link {
		display: inline-block;
		font-size: .875rem;
		color: var(--color-text-2);
		margin-bottom: var(--space-3);
	}

	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 2rem;
		margin-bottom: var(--space-1);
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	/* Tab bar */
	.tab-bar {
		display: inline-flex;
		align-self: flex-start;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.tab {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-right: 1.5px solid var(--color-border);
		color: var(--color-text-2);
		font-size: .875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.tab:last-child {
		border-right: none;
	}

	.tab:hover:not(.active) {
		color: var(--color-text-0);
	}

	.tab.active {
		background: var(--color-bg-2);
		color: var(--color-text-0);
	}

	/* Provider empty state */
	.provider-empty {
		display: flex;
		justify-content: center;
		padding: var(--space-5) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
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
		transition: border-color 0.15s, color 0.15s;
		text-decoration: none;
	}

	.btn-connect:hover {
		border-color: var(--color-text-1);
		color: var(--color-text-0);
	}

	/* Repo list */
	.search-row {
		display: flex;
		gap: var(--space-2);
	}

	.search-row input {
		flex: 1;
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
		max-height: 320px;
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

	fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		padding-bottom: var(--space-5);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input[type='text'],
	input[type='password'],
	select {
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

	input::placeholder {
		color: var(--color-text-2);
	}

	input:focus,
	select:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	select {
		cursor: pointer;
		appearance: none;
		font-family: var(--font-sans);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
	}

	.field-hint {
		font-size: .875rem;
		color: var(--color-text-2);
	}

	/* Domain preview */
	.domain-preview {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
	}

	/* Env editor */
	.env-editor {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.env-row {
		display: flex;
		align-items: center;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: .875rem;
	}

	.env-key {
		flex: 0 0 35%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-right: 1px solid var(--color-border);
		color: var(--color-term-cmd);
		font-family: var(--font-mono);
		font-size: .875rem;
		outline: none;
	}

	.env-key::placeholder {
		color: var(--color-text-2);
	}

	.env-eq {
		padding: 0 var(--space-1);
		color: var(--color-text-2);
		flex-shrink: 0;
	}

	.env-value {
		flex: 1;
		padding: var(--space-2) var(--space-2);
		background: transparent;
		border: none;
		color: var(--color-term-success);
		font-family: var(--font-mono);
		font-size: .875rem;
		outline: none;
	}

	.env-value.secret {
		color: var(--color-text-2);
	}

	.env-value::placeholder {
		color: var(--color-text-2);
	}

	.env-secret-toggle,
	.env-remove {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-2);
		cursor: pointer;
		font-size: .875rem;
		transition: color 0.1s;
	}

	.env-secret-toggle:hover,
	.env-remove:hover {
		color: var(--color-text-0);
	}

	.env-secret-toggle.active {
		color: var(--color-building);
	}

	.env-empty {
		padding: var(--space-3);
		color: var(--color-text-2);
		font-size: .875rem;
		text-align: center;
	}

	.env-add {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-top: 1px solid var(--color-border);
		color: var(--color-accent);
		font-size: .875rem;
		font-weight: 500;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.env-add:hover {
		background: var(--color-bg-2);
	}

	/* Deploy button */
	.btn-deploy {
		padding: var(--space-3) var(--space-4);
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition:
			background 0.15s,
			opacity 0.15s;
	}

	.btn-deploy:hover:not(:disabled) {
		background: var(--color-accent-dim);
	}

	.btn-deploy:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
