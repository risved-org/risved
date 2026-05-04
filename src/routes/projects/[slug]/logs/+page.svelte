<script lang="ts">
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	let containerLogs = $state('')
	let loaded = $state(false)
	let loading = $state(false)
	let tailLines = $state(200)
	let autoRefresh = $state(false)
	let refreshInterval = $state<ReturnType<typeof setInterval> | null>(null)

	async function fetchLogs() {
		loading = true
		try {
			const res = await fetch(`/api/projects/${data.project.id}/logs?tail=${tailLines}`)
			if (res.ok) {
				const body = await res.json()
				containerLogs = body.logs || 'No logs available.'
			} else {
				containerLogs = 'Failed to fetch logs.'
			}
			loaded = true
		} finally {
			loading = false
		}
	}

	function toggleAutoRefresh() {
		if (autoRefresh) {
			if (refreshInterval) clearInterval(refreshInterval)
			refreshInterval = null
			autoRefresh = false
		} else {
			autoRefresh = true
			refreshInterval = setInterval(fetchLogs, 5000)
		}
	}

	$effect(() => {
		fetchLogs()
		return () => {
			if (refreshInterval) clearInterval(refreshInterval)
		}
	})
</script>

<h1 class="page-title">Logs</h1>

<section data-testid="logs-section">
	<div class="section-header">
		<h2 class="section-title">Container Logs</h2>
		<div class="log-controls">
			<select class="lines-select" bind:value={tailLines} onchange={fetchLogs} aria-label="Lines">
				<option value={100}>100 lines</option>
				<option value={200}>200 lines</option>
				<option value={500}>500 lines</option>
				<option value={1000}>1000 lines</option>
			</select>
			<button
				class="btn-secondary btn-md"
				class:btn-active={autoRefresh}
				onclick={toggleAutoRefresh}
				data-testid="auto-refresh-btn"
			>
				{autoRefresh ? 'Stop auto-refresh' : 'Auto-refresh'}
			</button>
			<button class="btn-secondary btn-md" onclick={fetchLogs} disabled={loading} data-testid="refresh-logs-btn">
				{loading ? 'Loading…' : 'Refresh'}
			</button>
		</div>
	</div>

	{#if loaded}
		<pre class="container-logs" data-testid="container-logs">{containerLogs}</pre>
	{:else}
		<p class="empty-text">Loading logs…</p>
	{/if}
</section>

<style>
	.log-controls {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.lines-select {
		padding: var(--space-1) var(--space-2);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: .875rem;
		font-family: inherit;
		cursor: pointer;
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.lines-select:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.btn-active {
		background: var(--color-bg-2);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.container-logs {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: .875rem;
		line-height: 1.6;
		color: var(--color-text-1);
		overflow-x: auto;
		max-height: 600px;
		overflow-y: auto;
		white-space: pre;
		margin: 0;
	}
</style>
