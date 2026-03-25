<script lang="ts">
	import { enhance } from '$app/forms'
	import { resolve } from '$app/paths'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let showCards = $state(false)
	let showCustomGithubApp = $state(false)
	let savingGithubApp = $state(false)
	let showGithubAppSaved = $state(false)
	let showCustomGitlab = $state(false)
	let savingGitlabApp = $state(false)
	let showGitlabAppSaved = $state(false)
	let disconnecting = $state<string | null>(null)
	let refreshing = $state<string | null>(null)
	let generatingKey = $state(false)
	let revokingKey = $state(false)
	let savingDefaults = $state(false)
	let keyCopied = $state(false)
	let showForgejoForm = $state(false)
	let forgejoFormProvider = $state<'codeberg' | 'forgejo'>('forgejo')
	let forgejoUrl = $state('')
	let forgejoToken = $state('')
	let connectingForgejo = $state(false)
	let showForgejoSuccess = $state(false)
	let showKeyGenerated = $state(false)
	let showDefaultsSaved = $state(false)
	let autoWebhook = $state(data.defaults.autoWebhook)
	let commitStatus = $state(data.defaults.commitStatus)
	let deployPreviews = $state(data.defaults.deployPreviews)

	$effect(() => {
		if (form?.forgejoConnected) {
			showForgejoSuccess = true
			setTimeout(() => { showForgejoSuccess = false }, 3000)
		}
	})

	$effect(() => {
		if (form?.keyGenerated) {
			showKeyGenerated = true
			setTimeout(() => { showKeyGenerated = false }, 3000)
		}
	})

	$effect(() => {
		if (form?.defaultsSaved) {
			showDefaultsSaved = true
			setTimeout(() => { showDefaultsSaved = false }, 3000)
		}
	})
	$effect(() => {
		if (form?.githubAppSaved) {
			showGithubAppSaved = true
			setTimeout(() => { showGithubAppSaved = false }, 3000)
		}
	})
	$effect(() => {
		if (form?.gitlabAppSaved) {
			showGitlabAppSaved = true
			setTimeout(() => { showGitlabAppSaved = false }, 3000)
		}
	})

	const providerLabel: Record<string, string> = {
		github: 'GitHub',
		gitlab: 'GitLab',
		forgejo: 'Forgejo / Gitea'
	}

	const providerIcon: Record<string, string> = {
		github: 'GH',
		gitlab: 'GL',
		forgejo: 'FG'
	}

	const githubConnections = $derived(data.connections.filter((c) => c.provider === 'github'))
	const gitlabConnections = $derived(data.connections.filter((c) => c.provider === 'gitlab'))
	const forgejoConnections = $derived(data.connections.filter((c) => c.provider === 'forgejo'))
	const hasConnections = $derived(data.connections.length > 0)

	function connectionAge(createdAt: string): string {
		const diff = Date.now() - new Date(createdAt).getTime()
		const days = Math.floor(diff / 86400000)
		if (days < 1) return 'today'
		if (days === 1) return '1 day ago'
		if (days < 30) return `${days} days ago`
		const months = Math.floor(days / 30)
		if (months === 1) return '1 month ago'
		return `${months} months ago`
	}

	function closeAllForms() {
		showCustomGithubApp = false
		showCustomGitlab = false
		showForgejoForm = false
	}

	function copyKey() {
		if (data.sshPublicKey) {
			navigator.clipboard.writeText(data.sshPublicKey)
			keyCopied = true
			setTimeout(() => (keyCopied = false), 2000)
		}
	}
</script>

<svelte:head>
	<title>Git settings – Risved</title>
</svelte:head>

<article class="git-settings-page">
	<header class="page-header">
		<a href={resolve('/settings')} class="back-link">← Settings</a>
		<h1>Git settings</h1>
		<p class="subtitle">Manage connected accounts, deploy keys, and default webhook behavior.</p>
	</header>

	<section class="section" data-testid="git-provider">
		<h2 class="section-title">Git provider</h2>

		{#if !hasConnections || showCards}
			<div class="cards-grid">
				<!-- GitHub -->
				<div class="provider-card github-card" data-testid="github-card">
					<div class="card-header">
						<span class="provider-icon github">
							<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
						</span>
						<div>
							<h3 class="card-name">GitHub</h3>
							<p class="card-desc">OAuth · hosted</p>
						</div>
					</div>
					<a
						href={resolve('/api/git/github?action=connect')}
						class="btn-connect"
						data-testid="github-connect-btn"
					>
						{githubConnections.length > 0 ? 'Reconnect' : 'Connect'}
					</a>
					{#if !data.isCloud}
						<button
							class="btn-advanced"
							onclick={() => { const wasOpen = showCustomGithubApp; closeAllForms(); showCustomGithubApp = !wasOpen }}
							data-testid="github-custom-app-toggle"
						>
							{showCustomGithubApp ? 'Hide' : 'Use your own GitHub app'}
						</button>
					{/if}
				</div>

				<!-- GitLab -->
				<div class="provider-card" data-testid="gitlab-card">
					<div class="card-header">
						<span class="provider-icon gitlab">
							<svg viewBox="0 0 380 380" width="32" height="32" fill="currentColor"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.69-3.24 7 7 0 00-8 .43 7 7 0 00-2.32 3.52l-17.65 54h-71.47l-17.65-54a6.86 6.86 0 00-2.32-3.53 7 7 0 00-8-.43 6.87 6.87 0 00-2.69 3.24L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.07l.09.07.24.17 39.82 29.82 19.7 14.91 12 9.06a8.07 8.07 0 009.76 0l12-9.06 19.7-14.91 40.06-30 .1-.08a48.56 48.56 0 0016.08-56.04z"/></svg>
						</span>
						<div>
							<h3 class="card-name">GitLab</h3>
							<p class="card-desc">OAuth · hosted or self-hosted</p>
						</div>
					</div>
					<a
						href={resolve('/api/git/gitlab?action=connect')}
						class="btn-connect"
						data-testid="gitlab-connect-btn"
					>
						{gitlabConnections.length > 0 ? 'Reconnect' : 'Connect'}
					</a>
					{#if !data.isCloud}
						<button
							class="btn-advanced"
							onclick={() => { const wasOpen = showCustomGitlab; closeAllForms(); showCustomGitlab = !wasOpen }}
							data-testid="gitlab-custom-toggle"
						>
							{showCustomGitlab ? 'Hide' : 'Use your own GitLab app'}
						</button>
					{/if}
				</div>

				<!-- Codeberg -->
				<div class="provider-card" data-testid="codeberg-card">
					<div class="card-header">
						<span class="provider-icon codeberg">
							<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 4.233 4.233" width="20" height="20">
								<defs>
									<linearGradient xlink:href="#cb-stops" id="cb-grad" x1="42519.285" x2="42575.336" y1="-7078.789" y2="-6966.931" gradientUnits="userSpaceOnUse"/>
									<linearGradient id="cb-stops">
										<stop offset="0" style="stop-color:#fff;stop-opacity:0"/>
										<stop offset=".495" style="stop-color:#fff;stop-opacity:.3"/>
										<stop offset="1" style="stop-color:#fff;stop-opacity:.3"/>
									</linearGradient>
								</defs>
								<path d="M42519.285-7078.79a.76.568 0 0 0-.738.675l33.586 125.888a87.2 87.2 0 0 0 39.381-33.763l-71.565-92.52a.76.568 0 0 0-.664-.28" fill="url(#cb-grad)" transform="translate(-1030.156 172.97)scale(.02428)"/>
								<path d="M11249.461-1883.696c-12.74 0-23.067 10.327-23.067 23.067 0 4.334 1.22 8.58 3.522 12.251l19.232-24.863c.138-.18.486-.18.624 0l19.233 24.864a23.07 23.07 0 0 0 3.523-12.252c0-12.74-10.327-23.067-23.067-23.067" fill="#fff" transform="translate(-1030.156 172.97)scale(.09176)"/>
							</svg>
						</span>
						<div>
							<h3 class="card-name">Codeberg</h3>
							<p class="card-desc">API token · hosted</p>
						</div>
					</div>
					<button
						class="btn-connect"
						onclick={() => {
							const wasOpen = showForgejoForm && forgejoFormProvider === 'codeberg'
							closeAllForms()
							if (!wasOpen) { forgejoFormProvider = 'codeberg'; forgejoUrl = 'https://codeberg.org'; showForgejoForm = true }
						}}
						data-testid="codeberg-connect-btn"
					>
						{showForgejoForm && forgejoFormProvider === 'codeberg' ? 'Hide' : forgejoConnections.length > 0 ? 'Add another' : 'Connect'}
					</button>
				</div>

				<!-- Forgejo / Gitea -->
				<div class="provider-card" data-testid="forgejo-card">
					<div class="card-header">
						<span class="provider-icon forgejo">
							<svg viewBox="0 0 256 256" width="20" height="20" fill="none"><path d="M82 208.5V93.5C82 78.25 88.058 63.625 98.841 52.841 109.625 42.058 124.25 36 139.5 36H162.5" stroke="#FF5500" stroke-width="27"/><path d="M82 208.5V168.25C82 153 88.058 138.375 98.841 127.591 109.625 116.808 124.25 110.75 139.5 110.75H162.5" stroke="#C00" stroke-width="27"/><circle cx="174" cy="36" r="19" stroke="#FF5500" stroke-width="16"/><circle cx="174" cy="110.75" r="19" stroke="#C00" stroke-width="16"/><circle cx="82" cy="220" r="19" stroke="#C00" stroke-width="16"/></svg>
						</span>
						<div>
							<h3 class="card-name">Forgejo / Gitea</h3>
							<p class="card-desc">API token · self-hosted</p>
						</div>
					</div>
					<button
						class="btn-connect"
						onclick={() => {
							const wasOpen = showForgejoForm && forgejoFormProvider === 'forgejo'
							closeAllForms()
							if (!wasOpen) { forgejoFormProvider = 'forgejo'; forgejoUrl = ''; showForgejoForm = true }
						}}
						data-testid="forgejo-connect-btn"
					>
						{showForgejoForm && forgejoFormProvider === 'forgejo' ? 'Hide' : forgejoConnections.length > 0 ? 'Add another' : 'Connect'}
					</button>
				</div>
			</div>

			{#if !data.isCloud && showCustomGithubApp}
				<form
					method="post"
					action="?/saveGithubApp"
					use:enhance={() => {
						savingGithubApp = true
						return async ({ update }) => {
							savingGithubApp = false
							await update()
						}
					}}
				>
					<div class="form-card">
						<div class="form-group">
							<span class="form-label">Use your own GitHub app</span>
							<p class="form-hint">If you don't want a dependency on the risved.com GitHub app you can create your own and add the details here.</p>
						</div>
						<label class="form-group">
							<span class="form-label">App ID</span>
							<input type="text" name="appId" class="form-input mono" placeholder="123456" data-testid="github-app-id" />
						</label>
						<label class="form-group">
							<span class="form-label">Private key</span>
							<textarea name="privateKey" class="form-input mono" rows="4" placeholder="-----BEGIN RSA PRIVATE KEY-----" data-testid="github-app-key"></textarea>
						</label>
						<label class="form-group">
							<span class="form-label">Client ID</span>
							<input type="text" name="clientId" class="form-input mono" placeholder="Iv1.abc123" data-testid="github-client-id" />
						</label>
						<label class="form-group">
							<span class="form-label">Client secret</span>
							<input type="password" name="clientSecret" class="form-input mono" placeholder="secret" data-testid="github-client-secret" />
						</label>
						<div class="form-actions">
							<button type="submit" class="btn-primary" disabled={savingGithubApp} data-testid="github-save-app-btn">
								{savingGithubApp ? 'Saving…' : 'Save'}
							</button>
							{#if showGithubAppSaved}
								<span class="save-success">Saved</span>
							{/if}
							{#if form?.githubAppError}
								<span class="form-error">{form.githubAppError}</span>
							{/if}
						</div>
					</div>
				</form>
			{/if}

			{#if !data.isCloud && showCustomGitlab}
				<form
					method="post"
					action="?/saveGitlabApp"
					use:enhance={() => {
						savingGitlabApp = true
						return async ({ update }) => {
							savingGitlabApp = false
							await update()
						}
					}}
				>
					<div class="form-card">
						<div class="form-group">
							<span class="form-label">Use your own GitLab app</span>
							<p class="form-hint">If you don't want a dependency on the risved.com GitLab app or you self-host GitLab, create your own app and add the details here.</p>
						</div>
						<label class="form-group">
							<span class="form-label">Instance URL</span>
							<input type="url" name="instanceUrl" class="form-input mono" placeholder="https://gitlab.com" data-testid="gitlab-instance-url" />
							<p class="form-hint">Use gitlab.com for the hosted version, or your self-hosted GitLab URL.</p>
						</label>
						<label class="form-group">
							<span class="form-label">Application ID</span>
							<input type="text" name="applicationId" class="form-input mono" placeholder="your-application-id" data-testid="gitlab-app-id" />
						</label>
						<label class="form-group">
							<span class="form-label">Secret</span>
							<input type="password" name="secret" class="form-input mono" placeholder="your-secret" data-testid="gitlab-secret" />
						</label>
						<div class="form-actions">
							<button type="submit" class="btn-primary" disabled={savingGitlabApp} data-testid="gitlab-save-btn">
								{savingGitlabApp ? 'Saving…' : 'Save'}
							</button>
							{#if showGitlabAppSaved}
								<span class="save-success">Saved</span>
							{/if}
							{#if form?.gitlabAppError}
								<span class="form-error">{form.gitlabAppError}</span>
							{/if}
						</div>
					</div>
				</form>
			{/if}

			{#if showForgejoForm}
				<form
					method="post"
					action="?/forgejo"
					use:enhance={() => {
						connectingForgejo = true
						return async ({ update, result }) => {
							connectingForgejo = false
							if (result.type === 'success') {
								showForgejoForm = false
								forgejoUrl = ''
								forgejoToken = ''
							}
							await update()
						}
					}}
				>
					<div class="form-card">
						<label class="form-group">
							<span class="form-label">Instance URL</span>
							<input
								type="url"
								name="instanceUrl"
								bind:value={forgejoUrl}
								placeholder="https://example.org"
								class="form-input mono"
								data-testid="forgejo-url-input"
							/>
							<p class="form-hint">{forgejoFormProvider === 'codeberg' ? 'Your Codeberg instance URL.' : 'Your Forgejo or Gitea instance URL.'}</p>
						</label>

						<label class="form-group">
							<span class="form-label">API token</span>
							<input
								type="password"
								name="token"
								bind:value={forgejoToken}
								placeholder="your-api-token"
								class="form-input mono"
								data-testid="forgejo-token-input"
							/>
							<p class="form-hint">Generate at Settings → Applications on your instance.</p>
						</label>

						<div class="form-actions">
							<button
								type="submit"
								class="btn-primary"
								disabled={connectingForgejo || !forgejoUrl || !forgejoToken}
								data-testid="forgejo-submit-btn"
							>
								{connectingForgejo ? 'Connecting…' : 'Connect'}
							</button>
							<button type="button" class="btn-secondary" onclick={() => (showForgejoForm = false)}>
								Cancel
							</button>
							{#if showForgejoSuccess}
								<span class="save-success">Connected as {form?.accountName}</span>
							{/if}
							{#if form?.forgejoError}
								<span class="form-error" data-testid="forgejo-error">{form.forgejoError}</span>
							{/if}
						</div>
					</div>
				</form>
			{/if}
		{/if}

		{#if hasConnections}
			<div class="accounts-list">
				{#each data.connections as conn (conn.id)}
					<div class="account-row" data-testid="account-row">
						{#if conn.avatarUrl}
							<img src={conn.avatarUrl} alt="" class="account-avatar" />
						{:else}
							<span class="provider-icon {conn.provider} sm"
								>{providerIcon[conn.provider] ?? '?'}</span
							>
						{/if}
						<div class="account-info">
							<span class="account-name" data-testid="account-name">{conn.accountName}</span>
							<span class="account-provider">{providerLabel[conn.provider] ?? conn.provider}</span>
						</div>
						<div class="account-actions">
							<form
								method="post"
								action="?/refresh"
								use:enhance={() => {
									refreshing = conn.id
									return async ({ update }) => {
										refreshing = null
										await update()
									}
								}}
							>
								<input type="hidden" name="connectionId" value={conn.id} />
								<button
									type="submit"
									class="btn-secondary btn-sm"
									disabled={refreshing === conn.id}
									data-testid="refresh-btn"
								>
									{refreshing === conn.id ? 'Refreshing…' : 'Refresh'}
								</button>
							</form>
							<form
								method="post"
								action="?/disconnect"
								use:enhance={() => {
									disconnecting = conn.id
									return async ({ update }) => {
										disconnecting = null
										await update()
									}
								}}
							>
								<input type="hidden" name="connectionId" value={conn.id} />
								<button
									type="submit"
									class="btn-danger-sm"
									disabled={disconnecting === conn.id}
									data-testid="disconnect-btn"
								>
									{disconnecting === conn.id ? 'Removing…' : 'Disconnect'}
								</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
			{#if !showCards}
				<button
					class="btn-secondary"
					onclick={() => (showCards = true)}
					data-testid="add-another-btn"
				>
					Add another
				</button>
			{/if}
		{/if}
	</section>

	<!-- SSH deploy key -->
	<section class="section" data-testid="ssh-section">
		<h2 class="section-title">SSH deploy key</h2>
		<div class="form-card">
			<p class="form-hint-block">
				Add a read-only public key to your repositories for private repo access via SSH.
			</p>
			{#if data.sshPublicKey}
				<div class="key-display" data-testid="ssh-key-display">
					<code class="key-value mono" data-testid="ssh-key-value">{data.sshPublicKey}</code>
					<button class="btn-copy" onclick={copyKey} data-testid="copy-key-btn">
						{keyCopied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			{/if}
			<div class="key-actions">
				<form
					method="post"
					action="?/generateSshKey"
					use:enhance={() => {
						generatingKey = true
						return async ({ update }) => {
							generatingKey = false
							await update()
						}
					}}
				>
					<button
						type="submit"
						class="btn-secondary"
						disabled={generatingKey}
						data-testid="generate-key-btn"
					>
						{generatingKey
							? 'Generating…'
							: data.sshPublicKey
								? 'Regenerate key'
								: 'Generate deploy key'}
					</button>
				</form>

				{#if data.sshPublicKey}
					<form
						method="post"
						action="?/revokeSshKey"
						use:enhance={() => {
							revokingKey = true
							return async ({ update }) => {
								revokingKey = false
								await update()
							}
						}}
					>
						<button
							type="submit"
							class="btn-danger-sm"
							disabled={revokingKey}
							data-testid="revoke-key-btn"
						>
							{revokingKey ? 'Revoking…' : 'Revoke key'}
						</button>
					</form>
				{/if}
				{#if showKeyGenerated}
					<span class="save-success" data-testid="key-generated">Key generated</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- Default webhook settings -->
	<section class="section" data-testid="defaults-section">
		<h2 class="section-title">Default webhook settings</h2>
		<form
			method="post"
			action="?/saveDefaults"
			use:enhance={() => {
				savingDefaults = true
				return async ({ update }) => {
					savingDefaults = false
					await update({ reset: false })
				}
			}}
		>
			<div class="form-card">
				<label class="toggle-row" data-testid="auto-webhook-toggle">
					<input
						type="checkbox"
						name="autoWebhook"
						bind:checked={autoWebhook}
						class="toggle-input"
					/>
					<div class="toggle-text">
						<span class="toggle-label">Auto-configure webhook on import</span>
						<span class="toggle-hint"
							>Automatically set up webhooks when importing from a connected provider.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="commit-status-toggle">
					<input
						type="checkbox"
						name="commitStatus"
						bind:checked={commitStatus}
						class="toggle-input"
					/>
					<div class="toggle-text">
						<span class="toggle-label">Post commit status</span>
						<span class="toggle-hint"
							>Report build status back to the Git provider as commit checks.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="deploy-previews-toggle">
					<input
						type="checkbox"
						name="deployPreviews"
						bind:checked={deployPreviews}
						class="toggle-input"
					/>
					<div class="toggle-text">
						<span class="toggle-label">Enable deploy previews</span>
						<span class="toggle-hint"
							>Create preview deployments for pull/merge requests by default.</span
						>
					</div>
				</label>

				<div class="form-actions">
					<button
						type="submit"
						class="btn-primary"
						disabled={savingDefaults}
						data-testid="save-defaults-btn"
					>
						{savingDefaults ? 'Saving…' : 'Save defaults'}
					</button>
					{#if showDefaultsSaved}
						<span class="save-success" data-testid="defaults-saved">Saved</span>
					{/if}
				</div>
			</div>
		</form>
	</section>
</article>

<style>
	.git-settings-page {
		display: flex;
		flex-direction: column;
		margin: var(--space-4) auto var(--space-8);
		max-width: 40rem;
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
		font-size: 2rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	/* Provider cards grid */
	.cards-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}

	.provider-card {
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
		gap: var(--space-3);
	}
	.card-name {
		font-family: var(--font-sans);
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-0);
	}
	.card-desc {
		font-size: .875rem;
		color: var(--color-text-2);
		margin-top: 2px;
	}

	.provider-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		font-size: .875rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.provider-icon.github {
		background: #24292e;
		color: #fff;
	}
	.provider-icon.gitlab {
		background: #fc6d26;
		color: #fff;
	}
	.provider-icon.forgejo {
		background: #fff;
	}
	.provider-icon.codeberg {
		background: #2185d0;
		color: #fff;
	}
	.provider-icon.sm {
		width: 28px;
		height: 28px;
		font-size: .875rem;
	}

	.btn-advanced {
		background: none;
		border: none;
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
		padding: 0;
		text-align: center;
	}
	.btn-advanced:hover {
		color: var(--color-text-0);
	}

	.btn-connect {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		text-align: center;
	}
	.btn-connect:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Connected accounts */
	.accounts-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.account-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.account-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
	}
	.account-info {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.account-name {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.account-provider {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.account-actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	/* SSH key display */
	.form-hint-block {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.key-display {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.key-value {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		word-break: break-all;
		color: var(--color-text-0);
		line-height: 1.5;
	}

	.key-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* Toggle rows */
	.toggle-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		cursor: pointer;
		padding: var(--space-2) 0;
	}
	.toggle-input {
		margin-top: 2px;
		flex-shrink: 0;
		appearance: none;
		width: 16px;
		height: 16px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-2);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.toggle-input:checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: center;
	}
	.toggle-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toggle-label {
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-text-1);
	}
	.toggle-hint {
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.btn-sm {
		padding: var(--space-1) var(--space-3);
		font-size: .875rem;
	}

	.btn-copy {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
		flex-shrink: 0;
		margin-top: var(--space-2);
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
</style>
