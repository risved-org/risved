<section aria-label="Path routing">
	<label>
		Path prefix
		<input name="pathPrefix" value="/" placeholder="/blog" required />
	</label>
	<label>
		Forwarding mode
		<select name="forwardingMode">
			<option value="preserve">Preserve prefix</option>
			<option value="strip">Strip prefix</option>
		</select>
	</label>
	<p>
		The upstream app must generate URLs, redirects, asset paths, authentication callbacks and cookie
		paths for its public mount location. Stripping the prefix alone does not make a root-hosted app
		compatible with subpath hosting.
	</p>
</section>

<style>
	section {
		display: grid;
		gap: var(--space-2);
	}
	label {
		display: grid;
		gap: var(--space-1);
		font-size: 0.875rem;
	}
	input,
	select {
		padding: var(--space-2);
		background: var(--color-bg-1);
		color: var(--color-text-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	p {
		font-size: 0.875rem;
		color: var(--color-text-2);
	}
</style>
