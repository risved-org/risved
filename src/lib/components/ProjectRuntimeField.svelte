<script lang="ts">
	import { BUN_VERSION, supportsBun, type ProjectRuntime } from '$lib/project-runtime'

	let {
		runtime = $bindable<ProjectRuntime>('node'),
		frameworkId,
		tier,
		settings = false
	}: {
		runtime?: ProjectRuntime
		frameworkId?: string | null
		tier?: string | null
		settings?: boolean
	} = $props()

	const bunSupported = $derived(supportsBun(frameworkId, tier))

	$effect(() => {
		if (!bunSupported) runtime = 'node'
	})
</script>

<label>
	Server runtime
	<select name="runtime" bind:value={runtime} aria-describedby="runtime-hint">
		<option value="node">Node.js (default)</option>
		<option value="bun" disabled={!bunSupported}>Bun {BUN_VERSION}</option>
	</select>
	<span id="runtime-hint">
		{#if runtime === 'bun'}
			Bun runs the deployed server. Package-manager detection stays independent. SvelteKit uses its
			adapter-node build. Custom start commands must use Bun.
		{:else}
			Bun is available for SvelteKit, Elysia, and generic JavaScript/TypeScript servers.
		{/if}
		{#if settings}Changes apply on the next deployment.{/if}
	</span>
</label>

<style>
	label {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.875rem;
	}
	select {
		font: inherit;
		color: inherit;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0.75rem;
	}
	span {
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-text-2);
	}
</style>
