<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let showAddForm = $state(false);
	let hostname = $state('');
	let adding = $state(false);
	let verifyingId = $state<string | null>(null);
	let removingId = $state<string | null>(null);
	let copied = $state(false);

	function sslStatusLabel(status: string): string {
		if (status === 'active') return 'Active';
		if (status === 'provisioning') return 'Provisioning';
		if (status === 'error') return 'Error';
		return 'Pending';
	}

	function sslStatusClass(status: string): string {
		if (status === 'active') return 'ssl-active';
		if (status === 'provisioning') return 'ssl-provisioning';
		if (status === 'error') return 'ssl-error';
		return 'ssl-pending';
	}

	function copyIp(ip: string) {
		navigator.clipboard.writeText(ip);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head>
	<title>Domains — {data.project.name} — Risved</title>
</svelte:head>

<div class="domains-page">
	<header class="page-header">
		<a href={resolve(`/projects/${data.project.slug}`)} class="back-link">← {data.project.name}</a>
		<h1>Domains</h1>
	</header>

	<!-- Domain list -->
	<section class="section" data-testid="domains-list">
		<div class="section-header">
			<h2 class="section-title">Active Domains</h2>
			{#if !showAddForm}
				<button class="btn-sm" onclick={() => (showAddForm = true)} data-testid="add-domain-btn">
					Add domain
				</button>
			{/if}
		</div>

		{#if data.domains.length === 0 && !showAddForm}
			<p class="empty-text" data-testid="no-domains">No custom domains configured.</p>
		{/if}

		{#if data.domains.length > 0}
			<div class="domain-table" data-testid="domain-table">
				{#each data.domains as dom (dom.id)}
					<div class="domain-row" data-testid="domain-row">
						<div class="domain-info">
							<span class="domain-hostname mono" data-testid="domain-hostname">{dom.hostname}</span>
							{#if dom.isPrimary}
								<span class="primary-badge">Primary</span>
							{/if}
						</div>
						<div class="domain-status">
							<span class="ssl-badge {sslStatusClass(dom.sslStatus)}" data-testid="ssl-status">
								SSL: {sslStatusLabel(dom.sslStatus)}
							</span>
						</div>
						<div class="domain-actions">
							{#if !dom.isPrimary}
								<form
									method="post"
									action="?/primary"
									use:enhance={() => {
										return async ({ update }) => {
											await update();
										};
									}}
								>
									<input type="hidden" name="domainId" value={dom.id} />
									<button type="submit" class="btn-action" data-testid="set-primary-btn"
										>Set primary</button
									>
								</form>
							{/if}
							<form
								method="post"
								action="?/verify"
								use:enhance={() => {
									verifyingId = dom.id;
									return async ({ update }) => {
										verifyingId = null;
										await update();
									};
								}}
							>
								<input type="hidden" name="domainId" value={dom.id} />
								<button
									type="submit"
									class="btn-action"
									disabled={verifyingId === dom.id}
									data-testid="check-dns-btn"
								>
									{verifyingId === dom.id ? 'Checking…' : 'Check DNS'}
								</button>
							</form>
							<form
								method="post"
								action="?/remove"
								use:enhance={() => {
									removingId = dom.id;
									return async ({ update }) => {
										removingId = null;
										await update();
									};
								}}
							>
								<input type="hidden" name="domainId" value={dom.id} />
								<button
									type="submit"
									class="btn-action btn-action-danger"
									disabled={removingId === dom.id}
									data-testid="remove-domain-btn"
								>
									{removingId === dom.id ? 'Removing…' : 'Remove'}
								</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Add domain form -->
	{#if showAddForm}
		<section class="section" data-testid="add-domain-section">
			<h2 class="section-title">Add Domain</h2>

			<form
				method="post"
				action="?/add"
				use:enhance={() => {
					adding = true;
					return async ({ update, result }) => {
						adding = false;
						if (result.type === 'success') {
							showAddForm = false;
							hostname = '';
						}
						await update();
					};
				}}
			>
				<div class="add-form">
					<div class="input-row">
						<input
							type="text"
							name="hostname"
							bind:value={hostname}
							placeholder="app.example.com"
							class="hostname-input mono"
							data-testid="hostname-input"
						/>
						<button
							type="submit"
							class="btn-primary"
							disabled={adding || !hostname.trim()}
							data-testid="confirm-add-btn"
						>
							{adding ? 'Adding…' : 'Add'}
						</button>
						<button
							type="button"
							class="btn-cancel"
							onclick={() => {
								showAddForm = false;
								hostname = '';
							}}
						>
							Cancel
						</button>
					</div>
					{#if form?.error}
						<p class="form-error" data-testid="add-error">{form.error}</p>
					{/if}
				</div>
			</form>

			<!-- DNS record instructions -->
			<div class="dns-instructions" data-testid="dns-instructions">
				<h3 class="subsection-title">DNS Configuration</h3>
				<p class="dns-desc">
					Point your domain to this server by creating DNS records:
				</p>
				{#if data.serverIps.ipv4}
					<div class="dns-record-card" data-testid="dns-record">
						<div class="dns-row">
							<span class="dns-label">Type</span>
							<span class="dns-value mono">A</span>
						</div>
						<div class="dns-row">
							<span class="dns-label">Name</span>
							<span class="dns-value mono">{hostname || 'your-domain.com'}</span>
						</div>
						<div class="dns-row">
							<span class="dns-label">Value</span>
							<span class="dns-value mono" data-testid="server-ip">{data.serverIps.ipv4}</span>
							<button class="btn-copy" onclick={() => copyIp(data.serverIps.ipv4!)} data-testid="copy-ip-btn">
								{copied ? 'Copied!' : 'Copy'}
							</button>
						</div>
					</div>
				{/if}
				{#if data.serverIps.ipv6}
					<div class="dns-record-card" data-testid="dns-record-ipv6">
						<div class="dns-row">
							<span class="dns-label">Type</span>
							<span class="dns-value mono">AAAA</span>
						</div>
						<div class="dns-row">
							<span class="dns-label">Name</span>
							<span class="dns-value mono">{hostname || 'your-domain.com'}</span>
						</div>
						<div class="dns-row">
							<span class="dns-label">Value</span>
							<span class="dns-value mono" data-testid="server-ipv6">{data.serverIps.ipv6}</span>
							<button class="btn-copy" onclick={() => copyIp(data.serverIps.ipv6!)} data-testid="copy-ipv6-btn">
								{copied ? 'Copied!' : 'Copy'}
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Routing diagram -->
			<div class="routing-diagram" data-testid="routing-diagram">
				<h3 class="subsection-title">How it works</h3>
				<div class="diagram">
					<div class="diagram-node">
						<span class="diagram-icon">🌐</span>
						<span class="diagram-label">Browser</span>
					</div>
					<span class="diagram-arrow">→</span>
					<div class="diagram-node">
						<span class="diagram-icon">DNS</span>
						<span class="diagram-label">A / AAAA</span>
					</div>
					<span class="diagram-arrow">→</span>
					<div class="diagram-node">
						<span class="diagram-icon">🔒</span>
						<span class="diagram-label">Caddy</span>
						<span class="diagram-sub">TLS + Proxy</span>
					</div>
					<span class="diagram-arrow">→</span>
					<div class="diagram-node">
						<span class="diagram-icon">⚡</span>
						<span class="diagram-label">App</span>
						<span class="diagram-sub">:{data.project.port ?? '3001'}</span>
					</div>
				</div>
				<p class="diagram-note">
					SSL is automatically provisioned by Caddy once DNS verification passes.
				</p>
			</div>
		</section>
	{/if}
</div>

<style>
	.domains-page {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-8);
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-6);
	}

	.back-link {
		font-size: 0.8125rem;
		color: var(--color-text-2);
		display: inline-block;
		margin-bottom: var(--space-2);
	}
	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 600;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	/* Sections */
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.section-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.subsection-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-1);
		margin-bottom: var(--space-2);
	}
	.empty-text {
		color: var(--color-text-2);
		font-size: 0.85rem;
	}

	.btn-sm {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.btn-sm:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Domain table */
	.domain-table {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.domain-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.domain-row:last-child {
		border-bottom: none;
	}
	.domain-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
	}
	.domain-hostname {
		word-break: break-all;
	}
	.primary-badge {
		padding: 1px 6px;
		background: rgba(59, 130, 246, 0.15);
		color: var(--color-accent);
		border-radius: var(--radius-sm);
		font-size: 0.6875rem;
		font-weight: 500;
		flex-shrink: 0;
	}
	.domain-status {
		flex-shrink: 0;
	}
	.domain-actions {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	/* SSL badges */
	.ssl-badge {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}
	.ssl-active {
		color: var(--color-live);
		background: rgba(34, 197, 94, 0.12);
	}
	.ssl-provisioning {
		color: var(--color-building);
		background: rgba(234, 179, 8, 0.12);
	}
	.ssl-pending {
		color: var(--color-text-2);
		background: var(--color-bg-2);
	}
	.ssl-error {
		color: var(--color-failed);
		background: rgba(239, 68, 68, 0.12);
	}

	/* Action buttons */
	.btn-action {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-action:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-action-danger:hover {
		border-color: var(--color-failed);
		color: var(--color-failed);
	}

	/* Add domain form */
	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.input-row {
		display: flex;
		gap: var(--space-2);
	}
	.hostname-input {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 0.8125rem;
	}
	.hostname-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.hostname-input::placeholder {
		color: var(--color-text-2);
	}
	.btn-primary {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-primary:hover {
		opacity: 0.9;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-cancel {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.btn-cancel:hover {
		border-color: var(--color-text-2);
	}
	.form-error {
		color: var(--color-failed);
		font-size: 0.8125rem;
	}

	/* DNS record card */
	.dns-instructions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.dns-desc {
		font-size: 0.8125rem;
		color: var(--color-text-1);
		line-height: 1.5;
	}
	.dns-record-card {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.dns-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.dns-row:last-child {
		border-bottom: none;
	}
	.dns-label {
		width: 60px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		flex-shrink: 0;
	}
	.dns-value {
		flex: 1;
		color: var(--color-text-0);
	}
	.btn-copy {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: 0.75rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Routing diagram */
	.routing-diagram {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.diagram {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.diagram-node {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.diagram-icon {
		font-size: 1.2rem;
		line-height: 1;
	}
	.diagram-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.diagram-sub {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--color-text-2);
	}
	.diagram-arrow {
		color: var(--color-text-2);
		font-size: 1.2rem;
	}
	.diagram-note {
		font-size: 0.75rem;
		color: var(--color-text-2);
		text-align: center;
	}
</style>
