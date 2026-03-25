<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import StepIndicator from './StepIndicator.svelte';

	let { form }: { form: ActionData } = $props();

	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);

	const passwordTooShort = $derived(password.length > 0 && password.length < 8);
	const passwordsMatch = $derived(confirmPassword.length === 0 || password === confirmPassword);
</script>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={0} />

		<header>
			<h1>Create admin account</h1>
			<p class="subtitle">Set up the administrator account for your Risved instance.</p>
		</header>

		<form
			method="post"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			<div class="field">
				<label for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="username"
					required
					value={form?.email ?? ''}
					placeholder="admin@example.com"
				/>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength={8}
					bind:value={password}
					placeholder="At least 8 characters"
				/>
				{#if passwordTooShort}
					<p class="hint error">
						{password.length}/8 characters
					</p>
				{:else if password.length >= 8}
					<p class="hint ok">
						{password.length} characters
					</p>
				{/if}
			</div>

			<div class="field">
				<label for="confirmPassword">Confirm password</label>
				<input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					required
					minlength={8}
					bind:value={confirmPassword}
					placeholder="Repeat your password"
				/>
				{#if !passwordsMatch}
					<p class="hint error">Passwords do not match</p>
				{/if}
			</div>

			{#if form?.error}
				<p class="form-error" role="alert">{form.error}</p>
			{/if}

			<button type="submit" disabled={submitting || passwordTooShort || !passwordsMatch}>
				{submitting ? 'Creating account…' : 'Create account'}
			</button>
		</form>
	</div>
</div>

<style>
	.onboarding-card {
		width: 100%;
		max-width: 420px;
	}

	header {
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: 2rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	label {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 1rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	input::placeholder {
		color: var(--color-text-2);
	}

	input:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.hint {
		font-size: .875rem;
		font-family: var(--font-mono);
	}

	.hint.error {
		color: var(--color-failed);
	}

	.hint.ok {
		color: var(--color-live);
	}

	button {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition:
			background 0.15s,
			opacity 0.15s;
		margin-top: var(--space-2);
	}

	button:hover:not(:disabled) {
		background: var(--color-accent-dim);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
