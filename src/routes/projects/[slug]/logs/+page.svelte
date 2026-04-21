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

<section data-testid="logs-section">
	<div class="section-header">
		<h2 class="section-title">Container Logs</h2>
		<div class="log-controls">
			<label class="tail-label">
				Lines:
				<select bind:value={tailLines} onchange={fetchLogs}>
					<option value={100}>100</option>
					<option value={200}>200</option>
					<option value={500}>500</option>
					<option value={1000}>1000</option>
				</select>
			</label>
			<button
				class="btn-sm"
				class:btn-active={autoRefresh}
				onclick={toggleAutoRefresh}
				data-testid="auto-refresh-btn"
			>
				{autoRefresh ? 'Stop auto-refresh' : 'Auto-refresh'}
			</button>
			<button class="btn-sm" onclick={fetchLogs} disabled={loading} data-testid="refresh-logs-btn">
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
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.log-controls {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.tail-label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.tail-label select {
		padding: 2px var(--space-2);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-0);
		font-size: .875rem;
	}

	.btn-sm {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
	}
	.btn-sm:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-sm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		font-size: .8125rem;
		line-height: 1.6;
		color: var(--color-text-1);
		overflow-x: auto;
		max-height: 600px;
		overflow-y: auto;
		white-space: pre;
		margin: 0;
	}
</style>
