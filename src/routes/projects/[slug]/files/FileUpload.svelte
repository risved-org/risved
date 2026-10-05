<script lang="ts">
	import { invalidateAll } from '$app/navigation'
	import { validateFilePath } from '$lib/project-files'
	import { uploadFile, type UploadEntry } from './upload-file'
	import UploadResults from './UploadResults.svelte'

	let {
		path,
		directory,
		replacing,
		onclose
	}: {
		path: string
		directory: string
		replacing: boolean
		onclose: () => void
	} = $props()
	let destination = $derived(replacing ? path : directory)
	let items = $state<UploadEntry[]>([])
	let busy = $state(false)
	let started = $state(false)
	let localError = $state('')
	let formElement: HTMLFormElement
	const uploaded = $derived(items.filter(item => item.status === 'uploaded').length)
	const retryable = $derived(items.filter(item => item.status === 'failed'))
	const complete = $derived(items.length > 0 && uploaded === items.length)

	/** A new selection starts a fresh batch, leaving already saved files untouched. */
	function selectFiles(event: Event) {
		const files = Array.from((event.currentTarget as HTMLInputElement).files ?? [])
		items = (replacing ? files.slice(0, 1) : files).map(file => ({
			file,
			path: '',
			replace: replacing,
			status: 'ready',
			message: 'Ready to upload'
		}))
		started = false
		localError = ''
	}

	/** Keep each destination fixed across retries and refresh the listing once per batch. */
	async function run(batch: UploadEntry[]) {
		if (busy || batch.length === 0) return
		busy = true
		localError = ''
		const action = formElement.action
		try {
			for (const item of batch) await uploadFile(action, item)
			try {
				await invalidateAll()
			} catch {
				localError =
					'Uploads finished, but the file list couldn’t refresh. Reload to see your files.'
			}
		} finally {
			busy = false
		}
	}

	/** Validate the shared folder before assigning original filenames to the batch. */
	async function submit(event: SubmitEvent) {
		event.preventDefault()
		if (started) {
			await run(retryable)
			return
		}
		try {
			validateFilePath(destination, !replacing)
			if (items.length === 0) throw new Error('Choose one or more files to upload.')
			for (const item of items)
				item.path = replacing
					? path
					: destination
						? `${destination}/${item.file.name}`
						: item.file.name
		} catch (error) {
			localError = (error as Error).message
			return
		}
		started = true
		await run(items)
	}

	/** Replacement is authorized only by the confirmation beside the conflicting file. */
	function replace(item: UploadEntry) {
		item.replace = true
		void run([item])
	}
</script>

<form
	bind:this={formElement}
	method="post"
	action="?/upload"
	enctype="multipart/form-data"
	class="form-card"
	onsubmit={submit}
	aria-busy={busy}
>
	<h2 class="section-title">{replacing ? 'Replace file' : 'Upload files'}</h2>
	<label class="form-label"
		>{replacing ? 'File' : 'Files'}
		<input
			type="file"
			name="file"
			multiple={!replacing}
			required
			disabled={busy}
			oninput={selectFiles}
		/>
	</label>
	<p class="form-hint">
		{replacing ? 'Choose a replacement file.' : 'Choose one or more files.'} Up to 10 MiB each.
	</p>
	<label class="form-label"
		>{replacing ? 'File path' : 'Destination folder'}
		<input
			class="form-input"
			name="path"
			bind:value={destination}
			readonly={replacing || started}
			disabled={busy}
			placeholder={replacing ? '' : 'fonts'}
		/>
	</label>
	{#if replacing}
		<p class="form-hint">Replace “{path}”? The existing file will be overwritten.</p>
	{:else}
		<p class="form-hint">
			Relative to <code>/app/data</code>. Leave blank to upload there. New folders are created
			automatically.
		</p>
	{/if}
	{#if items.length > 0}
		<UploadResults {items} {busy} onretry={item => run([item])} onreplace={replace} />
	{/if}
	{#if started}<p class="form-hint" role="status">
			{uploaded} of {items.length}
			{items.length === 1 ? 'file' : 'files'} uploaded{busy ? '…' : '.'}
		</p>{/if}
	{#if localError}<p class="form-error" role="alert">{localError}</p>{/if}
	<footer class="form-actions">
		{#if !started || retryable.length > 0}
			<button class="btn-primary btn-lg" disabled={busy || items.length === 0}>
				{busy
					? 'Uploading…'
					: started
						? 'Retry failed uploads'
						: replacing
							? 'Replace file'
							: `Upload ${items.length || ''} ${items.length === 1 ? 'file' : 'files'}`}
			</button>
		{/if}
		<button type="button" class="btn-secondary btn-md" disabled={busy} onclick={onclose}
			>{complete ? 'Done' : started ? 'Close' : 'Cancel'}</button
		>
	</footer>
</form>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	input {
		width: 100%;
		min-width: 0;
	}
	input[type='file'] {
		font-size: 0.875rem;
		color: var(--color-text-1);
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
