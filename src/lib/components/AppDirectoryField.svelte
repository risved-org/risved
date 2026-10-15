<script lang="ts">
	let { value = $bindable('') }: { value?: string } = $props()
</script>

<label>
	App directory
	<input
		name="rootDir"
		aria-label="App directory"
		bind:value
		placeholder="apps/web"
		aria-describedby="app-directory-help"
		data-testid="root-dir-input"
	/>
	<small id="app-directory-help"
		>Leave empty for automatic detection at the repository root. For monorepos or other layouts,
		enter the folder containing your app.</small
	>
</label>

<style>
	label {
		display: grid;
		gap: 0.5rem;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		color: inherit;
		background: var(--color-bg-1);
	}
	small {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-2);
	}
</style>
