<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'
	let {
		data,
		showAddForm,
		onadd,
		copiedKey,
		copyIp
	}: {
		data: PageData
		showAddForm: boolean
		onadd: () => void
		copiedKey: string | null
		copyIp: (ip: string, key: string) => void
	} = $props()
	let verifyingId = $state<string | null>(null)
	let removingId = $state<string | null>(null)
	/** Describe the domain certificate state. */
	function sslStatusLabel(status: string): string {
		if (status === 'active') return 'Active'
		if (status === 'provisioning') return 'Provisioning'
		if (status === 'error') return 'Error'
		return 'Pending'
	}

	/** Select the existing certificate badge style. */
	function sslStatusClass(status: string): string {
		if (status === 'active') return 'badge-live'
		if (status === 'provisioning') return 'badge-building'
		if (status === 'error') return 'badge-failed'
		return 'badge-muted'
	}
</script>

<section data-testid="domains-list">
	<div class="section-header">
		<h2 class="section-title">Domains</h2>
		{#if !showAddForm}
			<button class="btn-secondary btn-md" onclick={onadd} data-testid="add-domain-btn">
				Add domain
			</button>
		{/if}
	</div>

	{#if data.domains.length === 0 && !showAddForm}
		<p class="empty-text" data-testid="no-domains">No custom domains configured.</p>
	{/if}

	{#if data.domains.length > 0}
		<div class="domain-list" data-testid="domain-table">
			{#each data.domains as dom (dom.id)}
				<article class="domain-card" data-testid="domain-row">
					<header class="domain-card-header">
						<div class="domain-info">
							<span class="domain-hostname mono" data-testid="domain-hostname"
								>{dom.hostname}{dom.pathPrefix ?? '/'}</span
							>
							<span class="badge-md badge-muted">{dom.forwardingMode ?? 'preserve'} prefix</span>
							{#if dom.isPrimary}
								<span class="badge-md badge-accent">Primary</span>
							{/if}
							<span class="badge-md {sslStatusClass(dom.sslStatus)}" data-testid="ssl-status">
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
											await update()
										}
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
									verifyingId = dom.id
									return async ({ update }) => {
										verifyingId = null
										await update()
									}
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
									removingId = dom.id
									return async ({ update }) => {
										removingId = null
										await update()
									}
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
					</header>

					{#if data.serverIps.ipv4 || data.serverIps.ipv6}
						<div class="dns-records" role="table" aria-label="DNS records for {dom.hostname}">
							<div class="dns-table-header" role="row">
								<span role="columnheader">Type</span>
								<span role="columnheader">Name</span>
								<span role="columnheader">Value</span>
							</div>
							{#if data.serverIps.ipv4}
								<div class="dns-table-row" role="row">
									<span role="cell"><code>A</code></span>
									<span role="cell"><code>{dom.hostname}</code></span>
									<span role="cell" class="dns-value-cell">
										<code>{data.serverIps.ipv4}</code>
										<button
											type="button"
											class="btn-copy"
											onclick={() => copyIp(data.serverIps.ipv4!, `${dom.id}:v4`)}
											aria-label="Copy IPv4"
										>
											{copiedKey === `${dom.id}:v4` ? 'Copied' : 'Copy'}
										</button>
									</span>
								</div>
							{/if}
							{#if data.serverIps.ipv6}
								<div class="dns-table-row" role="row">
									<span role="cell"><code>AAAA</code></span>
									<span role="cell"><code>{dom.hostname}</code></span>
									<span role="cell" class="dns-value-cell">
										<code>{data.serverIps.ipv6}</code>
										<button
											type="button"
											class="btn-copy"
											onclick={() => copyIp(data.serverIps.ipv6!, `${dom.id}:v6`)}
											aria-label="Copy IPv6"
										>
											{copiedKey === `${dom.id}:v6` ? 'Copied' : 'Copy'}
										</button>
									</span>
								</div>
							{/if}
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</section>

<style>
	/* Domain list */
	.domain-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.domain-card {
		display: flex;
		flex-direction: column;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.domain-card-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		flex-wrap: wrap;
	}
	.domain-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		flex-wrap: wrap;
	}
	.domain-hostname {
		word-break: break-all;
	}
	.domain-actions {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.dns-records {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-2);
	}
	.dns-table-header,
	.dns-table-row {
		display: grid;
		grid-template-columns: 3.75rem 1fr 1fr;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		align-items: center;
	}
	.dns-table-header {
		font-size: 0.75rem;
		line-height: 1.34;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}
	.dns-table-row {
		border-top: 1px solid var(--color-border);
	}
	.dns-table-row span {
		min-width: 0;
	}
	.dns-table-row code {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--color-text-0);
		word-break: break-all;
	}
	.dns-value-cell {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.dns-value-cell code {
		flex: 1;
		min-width: 0;
	}

	/* Action buttons */
	.btn-action {
		padding: 0.0625rem 0.25rem;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: 0.75rem;
		line-height: 1.34;
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

	.btn-copy {
		padding: 0.125rem var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: 0.875rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn-copy:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
</style>
