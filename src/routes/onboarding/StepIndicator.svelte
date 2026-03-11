<script lang="ts">
	type Step = { label: string; href: string };

	const steps: Step[] = [
		{ label: 'Account', href: '/onboarding' },
		{ label: 'Domain', href: '/onboarding/domain' },
		{ label: 'Verify', href: '/onboarding/verify' },
		{ label: 'Deploy', href: '/onboarding/deploy' }
	];

	let { current = 0 }: { current?: number } = $props();
</script>

<nav class="step-indicator" aria-label="Onboarding progress">
	<ol>
		{#each steps as step, i (step.label)}
			<li
				class="step"
				class:completed={i < current}
				class:active={i === current}
				class:upcoming={i > current}
				aria-current={i === current ? 'step' : undefined}
			>
				<span class="step-number">{i + 1}</span>
				<span class="step-label">{step.label}</span>
			</li>
			{#if i < steps.length - 1}
				<li class="connector" class:completed={i < current} aria-hidden="true"></li>
			{/if}
		{/each}
	</ol>
</nav>

<style>
	.step-indicator {
		margin-bottom: var(--space-8);
	}

	ol {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0;
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.step-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 600;
		font-family: var(--font-mono);
		border: 1.5px solid var(--color-border);
		color: var(--color-text-2);
		background: transparent;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.step-label {
		font-size: 0.85rem;
		color: var(--color-text-2);
		transition: color 0.2s;
	}

	.step.active .step-number {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: rgba(59, 130, 246, 0.1);
	}

	.step.active .step-label {
		color: var(--color-text-0);
	}

	.step.completed .step-number {
		border-color: var(--color-live);
		color: var(--color-bg-0);
		background: var(--color-live);
	}

	.step.completed .step-label {
		color: var(--color-text-1);
	}

	.connector {
		width: 32px;
		height: 1.5px;
		background: var(--color-border);
		margin: 0 var(--space-2);
		transition: background 0.2s;
	}

	.connector.completed {
		background: var(--color-live);
	}
</style>
