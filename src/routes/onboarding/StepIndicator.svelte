<script lang="ts">
	type Step = { label: string; href: string };

	const steps: Step[] = [
		{ label: 'Account', href: '/onboarding' },
		{ label: 'Domain', href: '/onboarding/domain' },
		{ label: 'Verify', href: '/onboarding/verify' },
		{ label: 'Git', href: '/onboarding/git' },
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
		{/each}
	</ol>
</nav>

<style>
	.step-indicator {
		margin-bottom: var(--space-6);
	}

	ol {
		list-style: none;
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-right: 1.5px solid var(--color-border);
		transition: background 0.15s, color 0.15s;
	}

	.step:last-child {
		border-right: none;
	}

	.step-number {
		font-size: .875rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--color-text-2);
	}

	.step-label {
		font-size: .875rem;
		font-weight: 600;
		color: var(--color-text-2);
	}

	.step.active {
		background: var(--color-bg-2);
	}

	.step.active .step-number {
		color: var(--color-accent);
	}

	.step.active .step-label {
		color: var(--color-text-0);
	}

	.step.completed .step-number {
		color: var(--color-live);
	}

	.step.completed .step-label {
		color: var(--color-text-1);
	}
</style>
