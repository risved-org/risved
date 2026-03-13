<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	let submitting = $state(false);
	let passkeyLoading = $state(false);
	let passkeyError = $state<string | null>(null);

	async function signInWithPasskey() {
		passkeyLoading = true;
		passkeyError = null;
		try {
			await authClient.signIn.passkey({
				fetchOptions: {
					onSuccess() {
						goto(resolve('/'));
					},
					onError(ctx) {
						passkeyError = ctx.error?.message || 'Passkey authentication failed';
						passkeyLoading = false;
					}
				}
			});
		} catch {
			passkeyError = 'Browser does not support passkeys or authentication was cancelled';
			passkeyLoading = false;
		}
	}
</script>

<div class="login">
	<div class="login-card">
		<header>
			<h1 class="wordmark">RISVED</h1>
			<p class="subtitle">Sign in to your instance</p>
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
					autocomplete="email"
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
					autocomplete="current-password"
					required
					placeholder="Enter your password"
				/>
			</div>

			{#if form?.error}
				<p class="form-error" role="alert">{form.error}</p>
			{/if}

			<button type="submit" disabled={submitting}>
				{submitting ? 'Signing in…' : 'Sign in'}
			</button>

			<div class="divider"><span>or</span></div>

			<button
				type="button"
				class="btn-passkey"
				disabled={passkeyLoading}
				onclick={signInWithPasskey}
				data-testid="passkey-login-btn"
			>
				{passkeyLoading ? 'Authenticating…' : 'Sign in with passkey'}
			</button>

			{#if passkeyError}
				<p class="form-error" role="alert" data-testid="passkey-login-error">
					{passkeyError}
				</p>
			{/if}

			<p class="forgot">
				Forgot password? Run <code>risved reset-password</code>
			</p>
		</form>
	</div>

	<footer class="status-footer">
		<span class="health-dot"></span>
		<span class="status-text">
			{data.projectCount} project{data.projectCount === 1 ? '' : 's'} running
		</span>
	</footer>
</div>

<style>
	.login {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-4);
	}

	.login-card {
		width: 100%;
		max-width: 380px;
	}

	header {
		text-align: center;
		margin-bottom: var(--space-8);
	}

	.wordmark {
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		margin-bottom: var(--space-2);
	}

	.subtitle {
		color: var(--color-text-1);
		font-size: 0.9rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 0.9rem;
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
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}

	.form-error {
		padding: var(--space-2) var(--space-3);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: 0.85rem;
	}

	button {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		font-size: 0.9rem;
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

	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--color-text-2);
		font-size: 0.8rem;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.btn-passkey {
		background: transparent;
		border: 1.5px solid var(--color-border);
		color: var(--color-text-1);
		margin-top: 0;
	}
	.btn-passkey:hover:not(:disabled) {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
		background: transparent;
	}

	.forgot {
		text-align: center;
		font-size: 0.8rem;
		color: var(--color-text-2);
	}

	.forgot code {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--color-text-1);
		background: var(--color-bg-2);
		padding: 0.1em 0.4em;
		border-radius: var(--radius-sm);
	}

	.status-footer {
		position: fixed;
		bottom: var(--space-4);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-2);
	}

	.health-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-live);
	}
</style>
