<script lang="ts">
	import { enhance } from '$app/forms'
	import { resolve } from '$app/paths'
	import { formatDate } from '$lib/format-date'
	import type { PageData, ActionData } from './$types'
	import FileUpload from './FileUpload.svelte'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let uploadPath = $state<string | null>(null)
	let replacing = $state(false)
	let deleting = $state<string | null>(null)
	let busy = $state(false)
	const parent = $derived(data.directory.split('/').slice(0, -1).join('/'))

	/** Keep nested destinations relative to the volume root. */
	function filePath(name: string) {
		return data.directory ? `${data.directory}/${name}` : name
	}
</script>

<svelte:head><title>Files – {data.project.name} – Risved</title></svelte:head>

<section aria-label="Project files">
	<header>
		<h1 class="section-title">Files</h1>
		{#if uploadPath === null}
			<button
				class="btn-secondary btn-md"
				onclick={() => {
					uploadPath = ''
					replacing = false
				}}>Upload files</button
			>
		{/if}
	</header>
	<p class="form-hint">
		Files in <code>/app/data</code> are kept across deployments. They aren’t public unless your app serves
		them.
	</p>

	{#if form?.error}<p class="form-error" role="alert">{form.error}</p>{/if}
	{#if form?.success}<p class="form-hint" role="status">{form.success}</p>{/if}
	{#if uploadPath !== null}
		{#key `${data.directory}:${uploadPath}`}
			<FileUpload
				path={uploadPath}
				directory={data.directory}
				{replacing}
				onclose={() => {
					uploadPath = null
				}}
			/>
		{/key}
	{/if}

	<nav aria-label="File location">
		<code>/app/data{data.directory ? `/${data.directory}` : ''}</code>
		{#if data.directory}<a
				href="{resolve(`/projects/${data.project.slug}/files`)}?directory={encodeURIComponent(
					parent
				)}">↑ Parent folder</a
			>{/if}
	</nav>
	{#if data.storageError}
		<p class="form-error" role="alert">{data.storageError}</p>
	{:else if data.entries.length === 0}
		<p class="empty-text">This folder is empty.</p>
	{:else}
		<ul>
			{#each data.entries as file (file.name)}
				<li>
					<header>
						{#if file.kind === 'directory'}
							<a
								href="{resolve(
									`/projects/${data.project.slug}/files`
								)}?directory={encodeURIComponent(filePath(file.name))}">{file.name}/</a
							>
						{:else}<strong>{file.name}</strong>{/if}
						<small
							>{file.kind === 'directory'
								? 'Folder'
								: `${new Intl.NumberFormat().format(file.size)} bytes`} · {formatDate(
								file.modifiedAt
							)}</small
						>
					</header>
					{#if file.kind === 'file'}
						{#if deleting === file.name}
							<form
								method="post"
								action="?/delete"
								use:enhance={() => {
									busy = true
									return async ({ update }) => {
										try {
											await update()
											deleting = null
										} finally {
											busy = false
										}
									}
								}}
							>
								<input type="hidden" name="path" value={filePath(file.name)} />
								<input type="hidden" name="confirm" value="yes" />
								<span class="form-hint">Delete “{file.name}”? This can’t be undone.</span>
								<button class="btn-danger btn-md" disabled={busy}
									>{busy ? 'Deleting…' : 'Confirm delete'}</button
								>
								<button
									type="button"
									class="btn-secondary btn-md"
									disabled={busy}
									onclick={() => {
										deleting = null
									}}>Cancel</button
								>
							</form>
						{:else}
							<footer>
								<button
									class="btn-secondary btn-md"
									disabled={busy}
									onclick={() => {
										uploadPath = filePath(file.name)
										replacing = true
									}}>Replace</button
								>
								<button
									class="btn-danger btn-md"
									disabled={busy}
									onclick={() => {
										deleting = file.name
									}}>Delete</button
								>
							</footer>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if data.totalPages > 1}
		<nav aria-label="File pages">
			{#if data.page > 1}
				<a
					href="{resolve(`/projects/${data.project.slug}/files`)}?directory={encodeURIComponent(
						data.directory
					)}&page={data.page - 1}">Previous page</a
				>
			{/if}
			<span>Page {data.page} of {data.totalPages}</span>
			{#if data.page < data.totalPages}
				<a
					href="{resolve(`/projects/${data.project.slug}/files`)}?directory={encodeURIComponent(
						data.directory
					)}&page={data.page + 1}">Next page</a
				>
			{/if}
		</nav>
	{/if}
	<p class="form-hint">
		Files are available at runtime and during release commands, but not during builds. You can
		manage files here even when your app is stopped.
	</p>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		max-width: 40rem;
		margin: 0 auto;
	}
	section > header,
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	nav {
		font-size: 0.875rem;
		margin-top: var(--space-2);
	}
	code,
	strong,
	a {
		overflow-wrap: anywhere;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-1);
	}
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
		flex-wrap: wrap;
	}
	li + li {
		border-top: 1px solid var(--color-border);
	}
	li header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}
	strong,
	li a {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 400;
	}
	small {
		color: var(--color-text-2);
		font-size: 0.75rem;
	}
	footer,
	form {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}
	.empty-text {
		font-size: 0.875rem;
		color: var(--color-text-2);
		padding: var(--space-5) 0;
	}
	@media (max-width: 35rem) {
		li header {
			flex-basis: 100%;
		}
	}
</style>
