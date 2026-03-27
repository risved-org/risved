<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import StepIndicator from '../StepIndicator.svelte';
	import { SvelteMap } from 'svelte/reactivity';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	let checking = $state(false);
	let copiedIndex = $state<number | null>(null);

	const hasV4 = !!data.serverIps.ipv4
	const hasV6 = !!data.serverIps.ipv6
	const typeLabel = hasV4 && hasV6 ? 'A and AAAA' : hasV6 ? 'AAAA' : 'A'

	const providers = [
		{ name: 'Cloudflare', hint: `DNS → Add Record → Type ${typeLabel} → Proxy status: DNS only` },
		{ name: 'Namecheap', hint: `Domain List → Manage → Advanced DNS → Add ${typeLabel} Record${hasV4 && hasV6 ? 's' : ''}` },
		{ name: 'Simply.com', hint: `DNS → Add Record → ${typeLabel} → Enter host and value` },
		{ name: 'Gandi', hint: `DNS Records → Add → ${typeLabel} record${hasV4 && hasV6 ? 's' : ''} → Set name and value` },
		{ name: 'GoDaddy', hint: `DNS Management → Add → Type ${typeLabel} → Enter details` },
		{ name: 'Route53', hint: `Hosted Zone → Create Record → Simple routing → ${typeLabel} record${hasV4 && hasV6 ? 's' : ''}` },
		{ name: 'Hover', hint: `DNS → Add ${typeLabel} Record${hasV4 && hasV6 ? 's' : ''} → Enter hostname and IP address` },
		{ name: 'Dynadot', hint: `Manage → DNS Settings → Add DNS Record → Type ${typeLabel} → Enter IP` },
		{ name: 'EuroDNS', hint: `DNS Zone → Add Record → Type ${typeLabel} → Set host and value` },
		{ name: 'Porkbun', hint: `DNS Records → Add → Type ${typeLabel} → Enter host and answer (IP)` }
	];

	let activeProvider = $state<string | null>(null);

	const allResolved = $derived(form?.allResolved ?? false);

	const recordResults = $derived.by(() => {
		if (!form?.results) return null;
		const map = new SvelteMap<string, boolean>();
		for (const r of form.results) {
			map.set(`${r.type}:${r.name}`, r.resolved);
		}
		return map;
	});

	async function copyToClipboard(text: string, index: number) {
		try {
			await navigator.clipboard.writeText(text);
			copiedIndex = index;
			setTimeout(() => {
				if (copiedIndex === index) copiedIndex = null;
			}, 2000);
		} catch {
			/* clipboard API may not be available */
		}
	}
</script>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={2} />

		<header>
			<h1>Verify DNS records</h1>
			<p class="subtitle">
				Point the following DNS records to your server. This enables HTTPS and automatic subdomains
				for your deployed apps and PR previews.
			</p>
		</header>

		{#if data.serverIps.ipv4}
			<div class="server-ip">
				<span class="ip-label">IPv4</span>
				<code class="ip-value">{data.serverIps.ipv4}</code>
				<button
					type="button"
					class="copy-btn"
					onclick={() => copyToClipboard(data.serverIps.ipv4!, -1)}
					aria-label="Copy IPv4 address"
				>
					{copiedIndex === -1 ? 'Copied' : 'Copy'}
				</button>
			</div>
		{/if}
		{#if data.serverIps.ipv6}
			<div class="server-ip">
				<span class="ip-label">IPv6</span>
				<code class="ip-value">{data.serverIps.ipv6}</code>
				<button
					type="button"
					class="copy-btn"
					onclick={() => copyToClipboard(data.serverIps.ipv6!, -2)}
					aria-label="Copy IPv6 address"
				>
					{copiedIndex === -2 ? 'Copied' : 'Copy'}
				</button>
			</div>
		{/if}

		<div class="dns-records" role="table" aria-label="Required DNS records">
			<div class="dns-header" role="row">
				<span class="dns-col-type" role="columnheader">Type</span>
				<span class="dns-col-name" role="columnheader">Name</span>
				<span class="dns-col-value" role="columnheader">Value</span>
				<span class="dns-col-status" role="columnheader">Status</span>
				<span class="dns-col-action" role="columnheader"></span>
			</div>
			{#each data.records as record, i (`${record.type}:${record.name}`)}
				{@const resolved = recordResults?.get(`${record.type}:${record.name}`)}
				<div class="dns-row" class:resolved role="row">
					<span class="dns-col-type dns-cell" role="cell">
						<code>{record.type}</code>
					</span>
					<span class="dns-col-name dns-cell" role="cell">
						<code>{record.name}</code>
					</span>
					<span class="dns-col-value dns-cell" role="cell">
						<code>{record.value}</code>
					</span>
					<span class="dns-col-status dns-cell" role="cell">
						{#if resolved === true}
							<span class="status-badge resolved" aria-label="Resolved">Resolved</span>
						{:else if resolved === false}
							<span class="status-badge pending" aria-label="Not found">Not found</span>
						{:else}
							<span class="status-badge waiting" aria-label="Waiting">Waiting</span>
						{/if}
					</span>
					<span class="dns-col-action dns-cell" role="cell">
						<button
							type="button"
							class="copy-btn"
							onclick={() => copyToClipboard(record.value, i)}
							aria-label="Copy {record.name} value"
						>
							{copiedIndex === i ? 'Copied' : 'Copy'}
						</button>
					</span>
				</div>
				<div class="dns-purpose">{record.purpose}</div>
			{/each}
		</div>

		<div class="wildcard-note">
			<strong>*.{data.domainConfig.baseDomain}</strong> enables automatic subdomains for every deployed
			app and PR preview – no extra DNS changes needed after setup.
		</div>

		<div class="provider-section">
			<p class="provider-label">Provider-specific instructions</p>
			<div class="provider-chips">
				{#each providers as provider (provider.name)}
					<button
						type="button"
						class="provider-chip"
						class:active={activeProvider === provider.name}
						onclick={() =>
							(activeProvider = activeProvider === provider.name ? null : provider.name)}
					>
						{provider.name}
					</button>
				{/each}
			</div>
			{#if activeProvider}
				{@const active = providers.find((p) => p.name === activeProvider)}
				{#if active}
					<div class="provider-hint" aria-live="polite">
						<p>{active.hint}</p>
					</div>
				{/if}
			{/if}
		</div>

		{#if allResolved}
			<div class="ssl-status" aria-live="polite">
				<div class="ssl-icon">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path
							d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zm3.7 6.7l-4.2 4.2a.75.75 0 01-1.06 0L6.3 10.3a.75.75 0 011.06-1.06l1.57 1.57 3.67-3.67a.75.75 0 011.06 1.06z"
							fill="currentColor"
						/>
					</svg>
				</div>
				<div>
					<p class="ssl-title">DNS verified – SSL certificates will be provisioned automatically</p>
					<p class="ssl-desc">
						Caddy will obtain and renew Let's Encrypt certificates for your domains.
					</p>
				</div>
			</div>

			<form method="post" action="?/skip">
				<button type="submit" class="btn-primary">Continue</button>
			</form>
		{:else}
			<div class="check-actions">
				<form
					method="post"
					action="?/check"
					use:enhance={() => {
						checking = true;
						return async ({ update }) => {
							checking = false;
							await update();
						};
					}}
				>
					<button type="submit" class="btn-primary" disabled={checking}>
						{checking ? 'Checking DNS…' : 'Check DNS'}
					</button>
				</form>

				<form method="post" action="?/skip">
					<button type="submit" class="btn-secondary">Skip for now</button>
				</form>
			</div>
		{/if}

		{#if form?.results && !allResolved}
			<p class="check-hint">DNS propagation can take a few minutes. Try again shortly.</p>
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

	.subtitle {
		color: var(--color-text-1);
		font-size: 1.25rem;
		line-height: 1.5;
	}

	/* Server IP */
	.server-ip {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-4);
	}

	.ip-label {
		font-size: .875rem;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}

	.ip-value {
		font-family: var(--font-mono);
		font-size: 1rem;
		color: var(--color-text-0);
		flex: 1;
	}

	/* DNS records table */
	.dns-records {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: var(--space-4);
	}

	.dns-header {
		display: grid;
		grid-template-columns: 50px 1fr 1fr 80px 60px;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		font-size: .875rem;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}

	.dns-row {
		display: grid;
		grid-template-columns: 50px 1fr 1fr 80px 60px;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-1);
		align-items: center;
	}

	.dns-row.resolved {
		background: color-mix(in srgb, var(--color-live) 4%, transparent);
	}

	.dns-cell code {
		font-family: var(--font-mono);
		font-size: .875rem;
		color: var(--color-text-0);
		word-break: break-all;
	}

	.dns-purpose {
		padding: 0 var(--space-3) var(--space-2);
		font-size: .875rem;
		color: var(--color-text-2);
		background: var(--color-bg-1);
		border-top: none;
	}

	/* Status badges */
	.status-badge {
		font-size: .875rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-weight: 500;
	}

	.status-badge.resolved {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}

	.status-badge.pending {
		background: color-mix(in srgb, var(--color-failed) 10%, transparent);
		color: var(--color-failed);
	}

	.status-badge.waiting {
		background: color-mix(in srgb, var(--color-stopped) 15%, transparent);
		color: var(--color-text-2);
	}

	/* Copy button */
	.copy-btn {
		padding: 2px 8px;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.copy-btn:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Wildcard note */
	.wildcard-note {
		padding: var(--space-3);
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 15%, transparent);
		border-radius: var(--radius-md);
		font-size: .875rem;
		color: var(--color-text-1);
		line-height: 1.5;
		margin-bottom: var(--space-4);
	}

	.wildcard-note strong {
		font-family: var(--font-mono);
		font-size: .875rem;
		color: var(--color-accent);
	}

	/* Provider chips */
	.provider-section {
		margin-bottom: var(--space-4);
	}

	.provider-label {
		font-size: .875rem;
		color: var(--color-text-1);
		font-weight: 500;
		margin-bottom: var(--space-2);
	}

	.provider-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.provider-chip {
		padding: var(--space-1) var(--space-2);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.provider-chip:hover {
		border-color: var(--color-text-2);
	}

	.provider-chip.active {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.provider-hint {
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: .875rem;
		color: var(--color-text-1);
		line-height: 1.5;
	}

	/* SSL status */
	.ssl-status {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		background: color-mix(in srgb, var(--color-live) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-live) 20%, transparent);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-4);
	}

	.ssl-icon {
		color: var(--color-live);
		flex-shrink: 0;
		margin-top: 1px;
	}

	.ssl-title {
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-live);
		margin-bottom: var(--space-1);
	}

	.ssl-desc {
		font-size: .875rem;
		color: var(--color-text-1);
	}

	.check-actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}

	.btn-secondary {
		padding: var(--space-2) var(--space-4);
		background: transparent;
		color: var(--color-text-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.btn-secondary:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	.check-hint {
		margin-top: var(--space-3);
		font-size: .875rem;
		color: var(--color-text-2);
	}

	form {
		display: contents;
	}
</style>
