<script lang="ts">
	import type { ActionData, PageData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<svelte:head><title>Connect MCP client · Risved</title></svelte:head>
<article>
	<h1>Connect {data.clientName}?</h1>
	<p>
		This client will have access to your Risved projects. It can create projects, change environment
		variables, deploy, read build logs and roll back deployments.
	</p>
	<p>Only allow access if you started this connection and trust this client.</p>
	<form method="post">
		<input type="hidden" name="code" value={data.code} />
		<button class="btn-primary" name="decision" value="allow">Allow access</button>
		<button class="btn-secondary" name="decision" value="deny">Deny</button>
	</form>
	{#if form?.error}<p role="alert">{form.error}</p>{/if}
</article>

<style>
	article {
		max-width: 36rem;
		margin: 4rem auto;
		padding: 1.5rem;
	}
	h1 {
		font-size: 1.75rem;
	}
	p {
		margin-block: 1.5rem;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
</style>
