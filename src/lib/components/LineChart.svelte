<script lang="ts">
	interface Point {
		label: string;
		value: number;
	}

	let {
		points,
		color = 'var(--color-accent)',
		height = 120,
		unit = '',
		label = ''
	}: {
		points: Point[];
		color?: string;
		height?: number;
		unit?: string;
		label?: string;
	} = $props();

	const W = 400;
	const PAD_X = 40;
	const PAD_Y = 20;
	const CHART_W = W - PAD_X * 2;
	const CHART_H = height - PAD_Y * 2;

	let maxVal = $derived(Math.max(...points.map((p) => p.value), 1));
	let yTicks = $derived(computeYTicks(maxVal));

	function computeYTicks(max: number): number[] {
		const step = Math.ceil(max / 3);
		return [0, step, step * 2, Math.ceil(max)];
	}

	function x(i: number): number {
		if (points.length <= 1) return PAD_X + CHART_W / 2;
		return PAD_X + (i / (points.length - 1)) * CHART_W;
	}

	function y(val: number): number {
		return PAD_Y + CHART_H - (val / maxVal) * CHART_H;
	}

	let pathD = $derived(
		points.length > 0
			? points
					.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
					.join(' ')
			: ''
	);

	let areaD = $derived(
		points.length > 0
			? pathD +
					` L${x(points.length - 1).toFixed(1)},${(PAD_Y + CHART_H).toFixed(1)} L${PAD_X.toFixed(1)},${(PAD_Y + CHART_H).toFixed(1)} Z`
			: ''
	);
</script>

<div class="chart-container" data-testid="line-chart">
	{#if points.length === 0}
		<div class="chart-empty" style="height: {height}px">No data yet</div>
	{:else}
		<div class="chart-wrapper">
			{#if label}
				<span class="chart-label-inner">{label}</span>
			{/if}
			<svg
				viewBox="0 0 {W} {height}"
				class="chart-svg"
			>
			<!-- Y-axis ticks -->
			{#each yTicks as tick, i (i)}
				<line
					x1={PAD_X}
					y1={y(tick)}
					x2={PAD_X + CHART_W}
					y2={y(tick)}
					stroke="var(--color-border)"
					stroke-dasharray="2,3"
				/>
				<text x={PAD_X - 4} y={y(tick) + 3} text-anchor="end" class="tick-text">
					{tick}{unit}
				</text>
			{/each}

			<!-- Area fill -->
			<path d={areaD} fill={color} opacity="0.1" />

			<!-- Line -->
			<path d={pathD} fill="none" stroke={color} stroke-width="1.5" />

			<!-- Dots -->
			{#each points as p, i (p.label + i)}
				<circle cx={x(i)} cy={y(p.value)} r="2" fill={color} />
			{/each}

			<!-- X-axis labels (first, mid, last) -->
			{#if points.length >= 2}
				<text x={x(0)} y={height - 2} text-anchor="start" class="tick-text">{points[0].label}</text>
				{#if points.length >= 3}
					<text
						x={x(Math.floor(points.length / 2))}
						y={height - 2}
						text-anchor="middle"
						class="tick-text">{points[Math.floor(points.length / 2)].label}</text
					>
				{/if}
				<text x={x(points.length - 1)} y={height - 2} text-anchor="end" class="tick-text"
					>{points[points.length - 1].label}</text
				>
			{/if}
		</svg>
		</div>
	{/if}
</div>

<style>
	.chart-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.chart-wrapper {
		position: relative;
	}

	.chart-label-inner {
		position: absolute;
		top: var(--space-2);
		right: var(--space-3);
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-2);
		font-family: var(--font-mono);
		letter-spacing: 0.05em;
		pointer-events: none;
	}

	.chart-svg {
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-1);
	}

	.chart-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-1);
		color: var(--color-text-2);
		font-size: .875rem;
	}

	.tick-text {
		font-size: .875rem;
		fill: var(--color-text-2);
		font-family: var(--font-mono);
	}
</style>
