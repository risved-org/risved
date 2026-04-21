<script lang="ts">
	import LineChart from '$lib/components/LineChart.svelte'

	let { data } = $props()

	function formatHour(iso: string): string {
		const d = new Date(iso)
		return `${d.getHours().toString().padStart(2, '0')}:00`
	}

	let serverCpuPoints = $derived(
		data.serverMetrics.map((m) => ({ label: formatHour(m.bucket), value: m.cpuPercent }))
	)
	let serverMemPoints = $derived(
		data.serverMetrics.map((m) => ({ label: formatHour(m.bucket), value: m.memoryMb }))
	)
</script>

<svelte:head>
	<title>Server metrics – Risved</title>
</svelte:head>

<article class="metrics-page">
	<h1>Server metrics</h1>

	<section class="resource-overview" data-testid="resource-overview">
		<h2 class="resource-title">Resource history</h2>
		<section class="resource-charts">
			<LineChart
				points={serverCpuPoints}
				label="CPU"
				color="var(--color-accent)"
				height={140}
			/>
			<LineChart
				points={serverMemPoints}
				label="Memory"
				color="var(--color-live)"
				height={140}
			/>
		</section>
	</section>
</article>

<style>
	.metrics-page {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: var(--space-4);
		gap: var(--space-4);
		max-width: 1200px;
		margin: 0 auto;
		width: 100%;
	}

	h1 {
		font-size: 2rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	.resource-overview {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.resource-title {
		font-family: var(--font-sans);
		font-size: .75rem;
		font-weight: 600;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.resource-charts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 600px) {
		.resource-charts {
			grid-template-columns: 1fr;
		}
	}
</style>
