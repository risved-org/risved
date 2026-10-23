<script lang="ts">
	import type { PageData } from './$types'
	let {
		data,
		hostname,
		copiedKey,
		copyIp
	}: {
		data: PageData
		hostname: string
		copiedKey: string | null
		copyIp: (ip: string, key: string) => void
	} = $props()
</script>

<!-- DNS record instructions -->
<div class="dns-instructions" data-testid="dns-instructions">
	<h3 class="subsection-title">DNS Configuration</h3>
	<p class="dns-desc">Point your domain to this server by creating DNS records:</p>
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
				<button
					class="btn-copy"
					onclick={() => copyIp(data.serverIps.ipv4!, 'add:v4')}
					data-testid="copy-ip-btn"
				>
					{copiedKey === 'add:v4' ? 'Copied!' : 'Copy'}
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
				<button
					class="btn-copy"
					onclick={() => copyIp(data.serverIps.ipv6!, 'add:v6')}
					data-testid="copy-ipv6-btn"
				>
					{copiedKey === 'add:v6' ? 'Copied!' : 'Copy'}
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

<style>
	.subsection-title {
		font-family: var(--font-sans);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-1);
		margin-bottom: var(--space-2);
	}
	/* DNS record card */
	.dns-instructions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.dns-desc {
		font-size: 0.875rem;
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
		width: 3.75rem;
		font-size: 0.875rem;
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
		gap: 0.125rem;
	}
	.diagram-icon {
		font-size: 1.25rem;
		line-height: 1;
	}
	.diagram-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.diagram-sub {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--color-text-2);
	}
	.diagram-arrow {
		color: var(--color-text-2);
		font-size: 1.25rem;
	}
	.diagram-note {
		font-size: 0.875rem;
		color: var(--color-text-2);
		text-align: center;
	}
</style>
