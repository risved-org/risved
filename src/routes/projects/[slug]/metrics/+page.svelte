<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import LineChart from '$lib/components/LineChart.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	function formatHour(iso: string): string {
		const d = new Date(iso)
		return `${d.getHours().toString().padStart(2, '0')}:00`
	}

	function formatDay(iso: string): string {
		const d = new Date(iso)
		return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:00`
	}

	let cpuPoints = $derived(
		data.resourceMetrics.map((m) => ({
			label: data.hours > 24 ? formatDay(m.bucket) : formatHour(m.bucket),
			value: m.cpuPercent
		}))
	)
	let memPoints = $derived(
		data.resourceMetrics.map((m) => ({
			label: data.hours > 24 ? formatDay(m.bucket) : formatHour(m.bucket),
			value: m.memoryMb
		}))
	)

	const ranges = [
		{ label: '6h', value: 6 },
		{ label: '12h', value: 12 },
		{ label: '24h', value: 24 },
		{ label: '48h', value: 48 },
		{ label: '7d', value: 168 }
	]

	function setRange(hours: number) {
		const url = new URL(page.url)
		url.searchParams.set('hours', String(hours))
		goto(url.toString(), { replaceState: true })
	}
</script>

<section class="section" data-testid="metrics-section">
	<div class="section-header">
		<h2 class="section-title">Resource History</h2>
		<div class="range-bar" data-testid="range-bar">
			{#each ranges as r (r.value)}
				<button
					class="range-btn"
					class:range-active={data.hours === r.value}
					onclick={() => setRange(r.value)}
				>
					{r.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="charts-grid">
		<LineChart points={cpuPoints} label="CPU %" color="var(--color-accent)" unit="%" />
		<LineChart points={memPoints} label="Memory (MB)" color="var(--color-live)" unit="MB" />
	</div>
</section>

<style>
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.range-bar {
		display: flex;
		gap: var(--space-1);
	}
	.range-btn {
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
	}
	.range-btn:hover {
		color: var(--color-text-1);
		border-color: var(--color-text-2);
	}
	.range-active {
		color: var(--color-text-0);
		background: var(--color-bg-2);
		border-color: var(--color-text-2);
	}

	.charts-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
	@media (max-width: 600px) {
		.charts-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
